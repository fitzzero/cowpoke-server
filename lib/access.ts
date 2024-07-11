import { AccessLevels } from '../../types/cowpoke/common'

export const accessString = (access: AccessLevels): string => {
  switch (access) {
    case AccessLevels.None:
      return 'No access'
    case AccessLevels.ReadBasic:
      return 'Viewer (basic)'
    case AccessLevels.ReadFull:
      return 'Viewer(full)'
    case AccessLevels.CreateEntity:
      return 'Creator'
    case AccessLevels.ModerateEntity:
      return 'Moderator'
  }
}
