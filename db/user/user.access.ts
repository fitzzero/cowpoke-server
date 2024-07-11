import { Schema } from 'mongoose'
import { MongoCollection, _BaseSchema } from '../_mongoCollection'
import { Users } from './users'
import { logAlert } from '../../lib/logger'
import { emitChanges } from '../../io/ioEvents'
import { Nullish } from '../../../types/cowpoke/_base'
import { Scopes, AccessProps } from '../../../types/cowpoke/access'
import { UserProps } from '../../../types/cowpoke/user'
import { EntityKinds, AccessLevels } from '../../../types/cowpoke/common'

const name = EntityKinds.Access

export const defaultAccess: Scopes = {
  // Basic
  [EntityKinds.User]: AccessLevels.ReadBasic,
  [EntityKinds.Session]: AccessLevels.None,
  [EntityKinds.Access]: AccessLevels.None,
  [EntityKinds.Ace]: AccessLevels.None,
  [EntityKinds.Accounts]: AccessLevels.None,
  // Discord
  // Oanda
  [EntityKinds.OandaAccount]: AccessLevels.None,
  [EntityKinds.OandaInstrument]: AccessLevels.ReadBasic,
  [EntityKinds.OandaOrder]: AccessLevels.None,
  [EntityKinds.OandaPosition]: AccessLevels.None,
  [EntityKinds.OandaPricing]: AccessLevels.None,
  [EntityKinds.OandaTrade]: AccessLevels.None,
  [EntityKinds.OandaTransaction]: AccessLevels.None,
}

const accessSchema = new Schema<AccessProps>({
  ..._BaseSchema,
  userId: { type: String, required: true },
  scopes: { type: Object, required: true, default: {} },
})

// Class
class Access extends MongoCollection<AccessProps> {
  // Lookup Access Control Entry Parent
  aceParent = EntityKinds.User

  findOrCreate = async (id: string) => {
    let access: AccessProps | Nullish = undefined
    access = await this.findOne({ userId: id })
    // Migrate new default access scopes
    if (access) {
      let changes = false
      for (const [key, value] of Object.entries(defaultAccess)) {
        // If no access, assign default
        if (!access.scopes?.[key as EntityKinds]) {
          changes = true
          access.scopes[key as EntityKinds] = value
        }

        // If default access is higher than current, assign it
        if (value > access.scopes?.[key as EntityKinds] || 0) {
          changes = true
          access.scopes[key as EntityKinds] = value
        }
      }
      // Save any changes from default access
      if (changes) {
        this.findByIdAndUpdate(access)
      }
    }
    // Else create new
    else {
      access = await this.create({
        userId: id.toString(),
        scopes: defaultAccess,
      })
      if (!access) {
        logAlert(`Failed to create new access for user: ${id}`, this.name)
        return
      }
      const updatedUser = await Users.findByIdAndUpdate({
        _id: id,
        accessId: access._id,
      })
      if (!updatedUser) return
      emitChanges<UserProps>(EntityKinds.User, updatedUser)
    }
    return access
  }
}

// Collection
export const Accesses = new Access(name, accessSchema)
