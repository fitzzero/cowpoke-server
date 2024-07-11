import { Schema } from 'mongoose'
import { MongoCollection, _BaseSchema } from '../_mongoCollection'
import { Nullish } from '../../../types/cowpoke/_base'
import { AceProps, AceLookup } from '../../../types/cowpoke/access'
import { EntityKinds, AccessLevels } from '../../../types/cowpoke/common'

const name = EntityKinds.Ace

const aceSchema = new Schema<AceProps>({
  ..._BaseSchema,
  entityKind: { type: String, enum: EntityKinds, required: true },
  entityId: { type: String, required: true },
  [AccessLevels.None]: { type: [String], required: true },
  [AccessLevels.ReadBasic]: { type: [String], required: true },
  [AccessLevels.ReadFull]: { type: [String], required: true },
  [AccessLevels.CreateEntity]: { type: [String], required: true },
  [AccessLevels.ModerateEntity]: {
    type: [String],
    required: true,
    default: [],
  },
})

// Class
class Ace extends MongoCollection<AceProps> {
  lookup: AceLookup = async (entityKind, entityId, defaultAccess) => {
    let ace: AceProps | Nullish = undefined
    ace = await this.findOne({ entityKind, entityId })
    // Else create new
    if (!ace) {
      const access = defaultAccess || {
        [AccessLevels.None]: [],
        [AccessLevels.ReadBasic]: [],
        [AccessLevels.ReadFull]: [],
        [AccessLevels.CreateEntity]: [],
        [AccessLevels.ModerateEntity]: [],
      }
      ace = await this.create({
        entityKind,
        entityId,
        ...access,
      })
    }
    return ace
  }
}

// Collection
export const Aces = new Ace(name, aceSchema)
