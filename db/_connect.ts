import mongoose from 'mongoose'
import { logAlert } from '../lib/logger'

export const startDatabase = async () => {
  if (!process.env.MONGODB_URI) {
    logAlert('MONGODB_URI not defined', 'database')
    return
  }
  mongoose.set('strictQuery', false)
  await mongoose.connect(process.env.MONGODB_URI)
}

export const db = mongoose
