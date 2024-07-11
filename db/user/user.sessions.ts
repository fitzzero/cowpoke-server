import { Schema } from 'mongoose'
import { MongoCollection, _BaseSchema } from '../_mongoCollection'
import { SessionProps } from '../../../types/cowpoke/user'
import { EntityKinds } from '../../../types/cowpoke/common'

const name = EntityKinds.Session

// Schema
const sessionSchema = new Schema<SessionProps>({
  ..._BaseSchema,
  sessionToken: { type: String, required: true },
  userId: { type: String, required: true },
  expires: { type: Date, required: true },
})

// Class
class Session extends MongoCollection<SessionProps> {}

// Collection
export const Sessions = new Session(name, sessionSchema)
