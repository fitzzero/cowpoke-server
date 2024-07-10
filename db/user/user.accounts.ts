import { Schema } from 'mongoose'
import { MongoCollection, _BaseSchema } from '../_mongoCollection'
import { UserAccountProps } from 'cowpoke-types/account'
import { EntityKinds } from '../../enums'

const name = EntityKinds.Accounts

// Schema
const sessionSchema = new Schema<UserAccountProps>({
  ..._BaseSchema,
  provider: { type: String, required: true },
  type: { type: String, required: true },
  providerAccountId: { type: String, required: true },
  token_type: { type: String, required: true },
  access_token: { type: String, required: true },
  expires_at: { type: Number, required: true },
  refresh_token: { type: String, required: true },
  scope: { type: String, required: true },
  userId: { type: String, required: true },
})

// Class
class UserAccount extends MongoCollection<UserAccountProps> {
  findOrCreate = async ({
    providerAccountId,
    provider,
    ...props
  }: Partial<UserAccountProps>) => {
    if (!providerAccountId || !provider) return
    const found = await this.findOne({ providerAccountId, provider })
    if (found) return found
    const created = await this.create({ providerAccountId, provider, ...props })
    return created
  }
}

// Collection
export const UserAccounts = new UserAccount(name, sessionSchema)
