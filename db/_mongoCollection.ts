import { Model, QueryOptions, Schema } from 'mongoose'
import {
  Id,
  IndexCollection,
  BasicProps,
  Nullish,
  PartialId,
  _BaseProps,
} from 'cowpoke-types/_base'
import { db } from './_connect'
import { logAlert, logStart, logStatus, logSuccess } from '../lib/logger'
import { Socket } from 'socket.io'
import { emitChanges } from '../io/ioEvents'
import {
  CreateRequest,
  DeleteRequest,
  ReadRequest,
  UpdateRequest,
  EntityResponse,
  IndexRequest,
  CustomEventCollection,
} from 'cowpoke-types/entity'
import { DeleteResult } from 'mongodb'
import { AccessProps, AceLookup, CheckAccessProps } from 'cowpoke-types/access'
import { defaultError, defaultUnauth } from '../lib/errors'
import { accessString } from '../lib/access'
import { union } from 'lodash'
import { AccessLevels, EntityKinds } from '../enums'

export const _BaseSchema = {
  createdAt: { type: Number, required: true },
  createdBy: { type: String, required: true },
  updatedAt: { type: Number, required: true },
  updatedBy: { type: String, required: true },
}

export const _BaseSchemaHeaders: (keyof _BaseProps)[] = [
  '_id',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
]

export interface MongoCollectionOptions<T> {
  basicProps?: (keyof BasicProps<T>)[]
  inMemory?: boolean
}

/*
 * Mongo Entity ClasslientMeta
 */
export class MongoCollection<T extends _BaseProps> {
  Model: Model<T & _BaseProps>
  name: EntityKinds
  aceLookup?: AceLookup
  aceParent?: EntityKinds
  basicProps: (keyof BasicProps<T>)[]
  collectionEvents?: CustomEventCollection<any>
  entityEvents?: CustomEventCollection<any>
  inMemory?: boolean
  localStorage: Map<string, T>
  roomJoin?: (entityId: string, userId: string) => void
  roomLeave?: (entityId: string, userId: string) => void

  /**
   * Constructor
   * @param name enum (EntityKinds)
   * @param schema mongoose schema
   * @param options BaseClassOptions
   * @returns BaseClass
   */
  constructor(
    name: EntityKinds,
    schema: Schema,
    options?: MongoCollectionOptions<T>
  ) {
    this.Model = db.model<T & _BaseProps>(name, schema)
    this.name = name
    this.basicProps = union(_BaseSchemaHeaders, options?.basicProps)
    this.inMemory = options?.inMemory
    this.localStorage = new Map<string, T>()

    logSuccess(name, `Connected to ${name} collection`)
  }

  /*
   * Public functions
   */

  // Add Collection Listeners to socket
  addCollectionListeners = async (socket: Socket, access: AccessProps) => {
    const highestAccess = await this.findHighestAccess({ access })
    if (highestAccess == AccessLevels.None) return
    if (highestAccess == AccessLevels.ReadBasic) {
      socket.on(`${this.name}.index`, (values, callback) =>
        this.indexRequest({ ...values, access }, callback)
      )
      socket.on(`${this.name}.read`, (values, callback) =>
        this.readRequest({ ...values, access }, callback)
      )
    }
    if (highestAccess >= AccessLevels.ReadBasic) {
      socket.on(`${this.name}.index`, (values, callback) =>
        this.indexRequest({ ...values, access, readFull: true }, callback)
      )
      socket.on(`${this.name}.read`, (values, callback) =>
        this.readRequest({ ...values, access, readFull: true }, callback)
      )
    }
    if (highestAccess >= AccessLevels.CreateEntity) {
      socket.on(`${this.name}.create`, (values, callback) =>
        this.createRequest({ ...values, access }, callback)
      )
      socket.on(`${this.name}.delete`, (values, callback) =>
        this.deleteRequest({ ...values, access }, callback)
      )
    }
    // For each custom collection event (if any)
    for (const event of this.collectionEvents || []) {
      // Skip if event requires higher access than user
      if (event.access > highestAccess) continue
      socket.on(`${this.name}.${event.name}`, (values, callback) =>
        event.handler({ ...values, access }, callback)
      )
    }
  }

  // Add Entity Listeners to socket
  addEntityListeners = async (
    socket: Socket,
    access: AccessProps,
    entity: Id
  ) => {
    const highestAccess = await this.findHighestAccess({ access, entity })
    const room = `${this.name}:${entity._id}`
    if (highestAccess == AccessLevels.None) return highestAccess
    if (highestAccess == AccessLevels.ReadBasic) {
      socket.on(`${room}.read`, (values, callback) =>
        this.readRequest({ ...values, access }, callback)
      )
      socket.join(`${room}:basic`)
    }
    if (highestAccess >= AccessLevels.ReadFull) {
      socket.on(`${room}.read`, (values, callback) =>
        this.readRequest({ ...values, access, readFull: true }, callback)
      )
      socket.join(room)
    }
    if (highestAccess >= AccessLevels.ModerateEntity) {
      socket.on(`${room}.update`, (values, callback) =>
        this.updateRequest({ ...values, access }, callback)
      )
    }
    // For each custom collection event (if any)
    for (const event of this.entityEvents || []) {
      // Skip if event requires higher access than user
      if (event.access > highestAccess) continue
      socket.on(`${this.name}.${event.name}`, (values, callback) =>
        event.handler({ ...values, access }, callback)
      )
    }
    return highestAccess
  }

  // Request to create and return a document
  createRequest: CreateRequest<T> = async ({ values, access }, callback) => {
    logStart(access?.userId || 'unknown', `${this.name}.create`)
    let res: EntityResponse<T> = defaultError

    // Create document
    const created = await this.create(values)
    // Update status
    if (created) {
      res.status.code = 200
      res.status.message = 'Created'
      res.values = created
    }
    logStatus(res.status, `${this.name}.create`, created?._id)
    return callback?.(res)
  }

  // Request to delete and return a document
  deleteRequest: DeleteRequest = async ({ values, access }, callback) => {
    logStart(access?.userId || 'unknown', `${this.name}.delete`)
    let res: EntityResponse<DeleteResult> = defaultError

    const result = await this.delete(values)
    if (result?.acknowledged) {
      logSuccess(`Deleted ${values._id}`, `${this.name}.delete`)
      res.status.code = 200
      res.status.message = 'Deleted'
      res.values = result
    }
    logStatus(res.status, `${this.name}.delete`, values._id)
    return callback?.(res)
  }

  // Emit changes to room
  emitChanges = (values: T & _BaseProps) => {
    emitChanges<T>(this.name, values, this.omitData({ ...values }))
  }

  // Request index and return a list of documents
  indexRequest: IndexRequest<T> = async (
    { values, index, access, readFull },
    callback
  ) => {
    logStart(access?.userId || 'unknown', `${this.name}.index`)
    const res: EntityResponse<IndexCollection<T>> = defaultError

    const limit = 20
    const skip = index?.page ? (index.page - 1) * limit : 0

    const found = await this.find(values, undefined, {
      skip,
      limit,
      sort: index?.sort,
    })

    // Limit data shown unless read full
    const indexCollection = readFull
      ? found
      : found?.map(doc => {
          this.omitData(doc)
          return doc
        })

    if (indexCollection) {
      const total = await this.Model.countDocuments(values)
      res.status.code = 200
      res.status.message = `Found ${total} total`
      res.values = indexCollection
      res.total = total
    } else {
      res.status.code = 404
      res.status.message = 'Not Found'
    }

    logStatus(res.status, `${this.name}.index`)
    return callback?.(res)
  }

  // Request to find and return a document
  readRequest: ReadRequest<T> = async (
    { values, access, readFull },
    callback
  ) => {
    logStart(access?.userId || 'unknown', `${this.name}.read`)
    const res: EntityResponse<T> = defaultError

    const found = await this.findOne(values)

    if (found) {
      if (!readFull) this.omitData(found)

      res.status.code = 200
      res.status.message = 'Found'
      res.values = found
    } else {
      res.status.code = 404
      res.status.message = 'Not Found'
    }

    logStatus(res.status, `${this.name}:read`, found?._id)
    return callback?.(res)
  }

  // Remove entity listeners from socket
  removeEntityListeners = async (socket: Socket, entity: Id) => {
    const room = `${this.name}:${entity._id}`
    socket.leave(room)
    socket.leave(`${room}:basic`)
    socket.removeAllListeners(`${room}.read`)
    socket.removeAllListeners(`${room}:basic`)
    socket.removeAllListeners(`${room}.update`)
    // For each custom collection event (if any)
    for (const event of this.entityEvents || []) {
      socket.removeAllListeners(`${this.name}.${event.name}`)
    }
  }

  // Request to update and return a document
  updateRequest: UpdateRequest<T> = async ({ values, access }, callback) => {
    logStart(access?.userId || 'unknown', `${this.name}.update`)
    let res: EntityResponse<T> = defaultError

    const updated = await this.findByIdAndUpdate({
      ...values,
      updatedAt: new Date().getTime(),
      updatedBy: access?.userId,
    })
    if (updated) {
      res.status.code = 200
      res.status.message = 'Updated'
      res.values = updated
      this.emitChanges(updated)
    } else {
    }
    logStatus(res.status, `${this.name}`, updated?._id)
    return callback?.(res)
  }

  /*
   * Private functions
   */

  // Check if user has access to entity and update response
  checkAccess = async ({
    access,
    entity,
    reqLevel,
    response,
  }: CheckAccessProps) => {
    const highestAccess = await this.findHighestAccess({ access, entity })

    if (highestAccess >= reqLevel) {
      response.status.relation = accessString(highestAccess)
    } else response = defaultUnauth

    return highestAccess
  }

  // Find the highest access level a user has over entity
  findHighestAccess = async ({
    access,
    entity,
  }: {
    access?: AccessProps
    entity?: Id
  }): Promise<AccessLevels> => {
    // If no access to check return unauthorized
    if (!access) return AccessLevels.None

    // Return accepted response if user has collection access
    const collectionAccess = this.aceParent
      ? access.scopes[this.aceParent]
      : access.scopes[this.name] || AccessLevels.None

    // No need to check entity if user is colleciton moderator
    if (collectionAccess === AccessLevels.ModerateEntity) {
      return collectionAccess
    }

    // Return collection access if there is no way to find entity access
    if (!entity || !this.aceLookup) return collectionAccess

    // Check entity ace if additional permissions exist
    const ace = await this.aceLookup(this?.aceParent || this.name, entity._id)

    // Shouldn't happen but error if no ace found
    if (!ace) return collectionAccess

    // If ace higher than collection found, return that instead
    for (
      let level: AccessLevels = collectionAccess;
      level <= AccessLevels.ModerateEntity;
      level++
    ) {
      if (ace[level].includes(access.userId)) {
        return level
      }
    }

    return collectionAccess
  }

  // https://mongoosejs.com/docs/api/model.html#Model.create
  create = async (values: Partial<T>) => {
    try {
      const date = new Date().getTime()
      const props = {
        ...values,
        createdAt: date,
        createdBy: values?.createdBy || 'system',
        updatedAt: date,
        updatedBy: values?.updatedBy || 'system',
      }
      const created = await this.Model.create(props)
      if (!created) return
      if (this.name != EntityKinds.Ace && this?.aceLookup) {
        await this.aceLookup(this?.aceParent || this.name, created._id, {
          [AccessLevels.None]: [],
          [AccessLevels.ReadBasic]: [],
          [AccessLevels.ReadFull]: [],
          [AccessLevels.CreateEntity]: [],
          [AccessLevels.ModerateEntity]: values?.createdBy
            ? [values.createdBy]
            : [],
        })
      }
      return created.toObject() as T & _BaseProps
    } catch (e: any) {
      logAlert(e, this.name)
    }
  }

  // https://mongoosejs.com/docs/api/model.html#Model.deleteOne()
  delete = async ({ _id }: Id) => {
    try {
      return await this.Model.deleteOne({ _id })
    } catch (e: any) {
      logAlert(e, this.name)
    }
  }

  // https://mongoosejs.com/docs/api/model.html#Model.find()
  find = async (
    criteria: Partial<T>,
    socket?: Socket,
    options?: QueryOptions<T>
  ) => {
    try {
      return (await this.Model.find(criteria, undefined, options).lean()) as
        | (T & _BaseProps)[]
        | Nullish
    } catch (e: any) {
      logAlert(e, this.name)
    }
  }

  // https://mongoosejs.com/docs/api/model.html#Model.findById()
  findById = async ({ _id }: Id) => {
    try {
      return (await this.Model.findById(_id).lean()) as
        | (T & _BaseProps)
        | Nullish
    } catch (e: any) {
      logAlert(e, this.name)
    }
  }

  // https://mongoosejs.com/docs/api/model.html#Model.findByIdAndUpdate()
  findByIdAndUpdate = async (values: PartialId<T>) => {
    // Requires _id to update
    if (!values?._id) return
    // Return value
    let updated: (T & _BaseProps) | Nullish = undefined
    // Local storage
    const local = this.inMemory ? this.localStorage?.get(values._id) : undefined
    // If local exists update that instead
    if (local) {
      updated = {
        ...local,
        ...values,
        updatedAt: values.updatedAt || new Date().getTime(),
        updatedBy: values.updatedBy || 'system',
      }
      this.localStorage.set(values._id, updated)

      // Return locally updated if it's not stale
      if (updated.updatedAt! - local.updatedAt! < 60000) {
        return updated
      }
    }

    // Try updating MongoDB
    try {
      updated = (await this.Model.findByIdAndUpdate(
        values._id,
        updated || values,
        {
          new: true,
        }
      ).lean()) as (T & _BaseProps) | Nullish
    } catch (e: any) {
      logAlert(e, this.name)
    }

    // Update local storage if collection is inMemory
    if (this.inMemory && !local && updated) {
      this.localStorage.set(values._id, updated)
    }

    // Return updated
    return updated
  }

  // https://mongoosejs.com/docs/api/model.html#Model.findOne()
  findOne = async (criteria: Partial<T & _BaseProps>) => {
    try {
      return (await this.Model.findOne(criteria).lean()) as T | Nullish
    } catch (e: any) {
      logAlert(e, this.name)
    }
  }

  // Strip any data that's not in basicProps
  omitData = (data: T) => {
    Object.keys(data).forEach(key => {
      if (!this.basicProps?.includes(key as keyof T)) {
        delete data[key as keyof T]
      }
    })
    return data
  }
}
