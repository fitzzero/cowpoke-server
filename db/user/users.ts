// Schema
import { MongoCollection, _BaseSchema } from '../_mongoCollection'
import { Schema } from 'mongoose'
import { Sessions } from './user.sessions'
import { Aces } from '../ace/ace'
import { UserAccounts } from './user.accounts'
import { logAlert } from '../../lib/logger'
import { UserProps } from '../../../types/cowpoke/user'
import { AccessLevels, EntityKinds } from '../../../types/cowpoke/common'

const name = EntityKinds.User

const userSchema = new Schema<UserProps>({
  ..._BaseSchema,
  accessId: { type: String },
  email: { type: String, required: true },
  emailVerified: { type: Boolean },
  image: { type: String },
  name: { type: String, required: true },
})

// Class
class User extends MongoCollection<UserProps> {
  // Lookup Access Control Entry
  aceLookup = Aces.lookup

  discordSync = async (token: string) => {
    try {
      const tokenResponseData = await fetch(
        'https://discord.com/api/oauth2/token',
        {
          method: 'POST',
          body: new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID || '',
            client_secret: process.env.DISCORD_CLIENT_SECRET || '',
            code: token,
            grant_type: 'authorization_code',
            redirect_uri: process.env.NEXTAUTH_URL || '',
            scope: 'identify',
          }).toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      )

      const oauthData = (await tokenResponseData.json()) as any
      if (!oauthData?.token_type || !oauthData?.access_token) {
        logAlert('Error validating discord code', 'ioEvents')
        return
      }

      const userResult = (await fetch('https://discord.com/api/users/@me', {
        headers: {
          authorization: `${oauthData.token_type} ${oauthData.access_token}`,
        },
      }).then(userResult => userResult.json())) as any

      if (!userResult.id) {
        logAlert('Error validating discord user', 'ioEvents')
        return
      }

      const account = await UserAccounts.findOne({
        providerAccountId: userResult.id,
        provider: 'discord',
      })
      if (!account) {
        // Create new user, user.accounts, and user.ace
        const user = await this.create({
          email: userResult.email,
          name: userResult.username,
          image: `https://cdn.discordapp.com/avatars/${userResult.id}/${userResult.avatar}`,
          emailVerified: userResult.verified,
        })
        if (!user) {
          logAlert('Error creating new user', 'ioEvents')
          return
        }
        // Create Account for new user
        await UserAccounts.findOrCreate({
          providerAccountId: userResult.id,
          provider: 'discord',
          type: 'oauth',
          access_token: oauthData.access_token,
          token_type: oauthData.token_type,
          expires_at: Date.now() + oauthData.expires_in * 1000,
          refresh_token: oauthData.refresh_token,
          scope: oauthData.scope,
          userId: user._id,
        })
        // Create ACE for new user
        await Aces.lookup(this.name, user._id, {
          [AccessLevels.None]: [],
          [AccessLevels.ReadBasic]: [],
          [AccessLevels.ReadFull]: [],
          [AccessLevels.CreateEntity]: [],
          [AccessLevels.ModerateEntity]: [user._id.toString()],
        })
        return
      } else {
        const user = await this.findById({ _id: account.userId })
        return user
      }
    } catch (e) {
      logAlert(e as string, 'ioEvents')
    }
    return null
  }

  findBySession = async (token: string) => {
    const session = await Sessions.findOne({ sessionToken: token })
    // If no session found return undefined
    if (!session) return
    const now = new Date()
    // If session is expired return undefined
    if (session.expires < now) {
      logAlert(`Session expired for token: ${token}`, this.name)
      return
    }

    return await this.findById({ _id: session.userId })
  }

  sessionSync = async (token: string) => {
    // Find valid user by socket
    const user = await this.validateSocket(token)
    if (!user) return

    // Find or create Ace
    const ace = await Aces.lookup(this.name, user._id, {
      [AccessLevels.None]: [],
      [AccessLevels.ReadBasic]: [],
      [AccessLevels.ReadFull]: [],
      [AccessLevels.CreateEntity]: [],
      [AccessLevels.ModerateEntity]: [user._id.toString()],
    })
    if (!ace) {
      logAlert(`Failed to find or create Ace for user: ${user._id}`, this.name)
    }

    // Update user and save
    const now = new Date().getTime()
    if (!user.createdAt) user.createdAt = now
    if (!user.createdBy) user.createdBy = user._id
    user.updatedAt = now
    user.updatedBy = user._id
    const updated = await this.findByIdAndUpdate(user)
    if (!updated) {
      logAlert(`Failed to update user: ${user._id}`, this.name)
      return
    }

    return updated
  }

  validateSocket = async (token: string) => {
    const user = await this.findBySession(token)
    if (!user) {
      logAlert(`No valid session found for token: ${token}`, this.name)
      return
    }

    return user
  }
}

// Collection
export const Users = new User(name, userSchema, {
  basicProps: ['name', 'image'],
})
