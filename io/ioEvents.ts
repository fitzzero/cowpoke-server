import { Socket } from 'socket.io'
import { Users } from '../db/user/users'
import { ioServer } from '../express'
import { logEnd, logStart, logSuccess } from '../lib/logger'
import { MongoCollection } from '../db/_mongoCollection'
import { Accesses } from '../db/user/user.access'
import { defaultError } from '../lib/errors'
import { Instruments } from '../../db/oanda/instrument'
import { accessString } from '../lib/access'
import { _BaseProps } from '../../types/cowpoke/_base'
import { AccessProps } from '../../types/cowpoke/access'
import { Callback, EntityResponse } from '../../types/cowpoke/entity'
import { UserProps } from '../../types/cowpoke/user'
import { EntityKinds } from '../../types/cowpoke/common'

/*
 * Types
 */
interface Client {
  socket: Socket
  userId: string
}

type Clients = Record<string, Client>

export interface HandlerProps {
  access: AccessProps
  socket: Socket
}

export interface SubProps extends HandlerProps {
  room?: string
  callback?: Callback<{}>
}

export type AuthenticateConnection = (
  values: { token: string },
  callback: Callback<AccessProps>
) => void

/*
 * Collection
 */

export const clients: Clients = {}

/*
 * Entities
 */
const Entities: MongoCollection<any>[] = [Users, Accesses, Instruments]

const useIo = () => ioServer?.of('/server')

/*
 * Event listeners added on IO Server Start
 */
export const ioEvents = () => {
  const io = useIo()
  // Listen connection
  io.on('connection', socket => {
    logStart('New connection...', 'io')

    // Listen for discord activity handshake
    socket.on(
      'discord',
      async (values: { token: string }, callback: Callback<AccessProps>) => {
        const response: EntityResponse<AccessProps> = defaultError
        // Find user by discord oauth code
        const user = await Users.discordSync(values.token)

        // Return user or error
        if (user) {
          // Find or create user access (or error)
          const access = await Accesses.findOrCreate(user._id)
          if (!access) return callback?.(response)

          // Subscribe events if user and user.access
          clientSubscribeEvents({ socket, access, user })
          response.status.code = 200
          response.status.message = 'Session established'
          response.values = access
          return callback?.(response)
        } else {
          return callback?.(response)
        }
      }
    )

    // Listen for session handshake
    socket.on(
      'session',
      async (values: { token?: string }, callback: Callback<AccessProps>) => {
        const response: EntityResponse<AccessProps> = defaultError
        if (!values.token) {
          response.status.message = 'No token provided'
          return callback?.(response)
        }
        // Find user by session
        const user = await Users.sessionSync(values.token)
        // Return user or error
        if (user) {
          // Find or create user access (or error)
          const access = await Accesses.findOrCreate(user._id)
          if (!access) return callback?.(response)

          // Subscribe events if user and user.access
          clientSubscribeEvents({ socket, access, user })
          response.status.code = 200
          response.status.message = 'Session established'
          response.values = access
          return callback?.(response)
        } else {
          return callback?.(response)
        }
      }
    )
  })

  // Listen for room joins
  io.adapter.on('join-room', (room, id) => {
    const kind = room?.split(':')[0] as EntityKinds
    const _id = room?.split(':')[1]
    if (!_id || !kind) return
    const entity = Entities.find(e => e.name === kind)
    if (!entity) return
    const userId = clients?.[id]?.userId
    if (!userId) return
    entity?.roomJoin?.(_id, userId)
  })

  // Listen for room leaves
  io.adapter.on('leave-room', (room, id) => {
    const kind = room?.split(':')[0] as EntityKinds
    const _id = room?.split(':')[1]
    if (!_id || !kind) return
    const entity = Entities.find(e => e.name === kind)
    if (!entity) return
    const userId = clients?.[id]?.userId
    if (!userId) return
    entity?.roomLeave?.(_id, userId)
  })
}

/*
 * Functions
 */

/**
 * Subscribe clients to events
 * @param socket  The user Client session socket
 * @param user  The validated user <Props>
 */
export const clientSubscribeEvents = ({
  access,
  socket,
  user,
}: {
  access: AccessProps
  socket: Socket
  user: UserProps
}) => {
  const userId = user._id.toString()

  // Listen Disconnect
  socket.on('disconnect', () => {
    // Cleanup
    delete clients[socket.id]
    logEnd(
      `${user.name} (${user._id}) disconnected | ${
        Object.keys(clients).length
      } online`,
      'io'
    )
  })

  // Listen Subscribe
  socket.on('sub', (room: string, callback?: Callback<{}>) => {
    sub({
      access,
      callback,
      room,
      socket,
    })
  })

  // Listen Unsubscribe
  socket.on('unsub', (room: string, callback?: Callback<{}>) => {
    unsub({
      access,
      callback,
      room,
      socket,
    })
  })

  Entities.forEach(entity => {
    entity.addCollectionListeners(socket, access)
  })

  // Add client
  clients[socket.id] = { userId, socket }

  logSuccess(
    `${user.name} (${user._id}) subscribed | ${
      Object.keys(clients).length
    } online`,
    'io'
  )
}

// Broadcast changes to clients
export const emitChanges = <T>(
  kind: EntityKinds,
  values: T & _BaseProps,
  valuesBasic?: Partial<T> & _BaseProps
) => {
  const io = useIo()
  const room = `${kind}:${values._id}`
  const roomBasic = `${room}:basic`
  io.to(room).emit(room, values)
  if (valuesBasic) io.to(roomBasic).emit(roomBasic, valuesBasic)
}

// Subscribe client to rooms
const sub = async ({ room, access, socket, callback }: SubProps) => {
  const res = defaultError
  const kind = room?.split(':')[0] as EntityKinds
  const _id = room?.split(':')[1]
  if (!_id || !kind) {
    res.status.message = 'Invalid subscription'
    return callback?.(res)
  }

  // Check access
  const entity = Entities.find(e => e.name === kind)
  if (!entity) {
    res.status.message = `${kind} not found`
    return callback?.(res)
  }

  const highestAccess = await entity.addEntityListeners(socket, access, {
    _id,
  })
  res.status.code = 200
  res.status.message = `Subscribed as ${accessString(highestAccess)}`
  return callback?.(res)
}

// Unsubscribe client from rooms
const unsub = async ({ access, room, socket, callback }: SubProps) => {
  const res = defaultError
  const kind = room?.split(':')[0] as EntityKinds
  const _id = room?.split(':')[1]
  if (!_id || !kind) {
    res.status.message = 'Invalid subscription'
    return callback?.(res)
  }
  const entity = Entities.find(e => e.name === kind)
  if (!entity) {
    res.status.message = `${kind} not found`
    return callback?.(res)
  }
  await entity.removeEntityListeners(socket, access)
  socket.leave(room)
  socket.leave(`${room}:basic`)
  res.status.code = 200
  res.status.message = 'Unsubscribed'
  return callback?.(res)
}
