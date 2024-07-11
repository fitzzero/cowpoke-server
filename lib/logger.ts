import { Status } from '../../types/cowpoke/_base'

export interface LoggerOptions {
  type?: 'alert' | 'start' | 'success' | 'dev' | 'end'
}

const prefixIcons = {
  alert: '⚠ ',
  dev: '✎ ',
  end: '< ',
  success: '✔ ',
  start: '> ',
  none: '',
}

export const logger = (message: string, options?: LoggerOptions) => {
  let prefix = ''
  if (options?.type) prefix = prefixIcons[options.type]
  console.log(prefix + message)
}

export const logAlert = (message: string, location: string) => {
  logger(`${location}:\n${message}`, { type: 'alert' })
}

export const logDev = (message: string, location: string) => {
  if (process.env.NODE_ENV != 'development') return
  logger(`${location}: ${message}`, { type: 'dev' })
}

export const logEnd = (message: string, location: string) => {
  logger(`${location}: ${message}`, { type: 'end' })
}

export const logStart = (message: string, location: string) => {
  logger(`${location}: ${message}`, { type: 'start' })
}

export const logSuccess = (message: string, location: string) => {
  logger(`${location}: ${message}`, { type: 'success' })
}
export const logStatus = (status: Status, location: string, id?: string) => {
  if (status.code == 200) {
    logSuccess(
      `${status.code} - ${status.message} ${id ? id : ''}${
        status?.relation ? ` (${status.relation})` : ''
      }`,
      location
    )
  } else {
    logAlert(`${status.code} - ${status.message}`, location)
  }
}
