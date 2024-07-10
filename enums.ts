export enum AccessLevels {
  None = 0,
  ReadBasic = 1,
  ReadFull = 2,
  CreateEntity = 3,
  ModerateEntity = 4,
}

export enum EntityKinds {
  User = 'user',
  Access = 'user.access',
  Accounts = 'user.accounts',
  Session = 'user.session',
  Ace = 'ace',
  // Discord
  // Oanda
  OandaAccount = 'oanda.account',
  OandaInstrument = 'oanda.instrument',
  OandaOrder = 'oanda.order',
  OandaPosition = 'oanda.position',
  OandaPricing = 'oanda.pricing',
  OandaTrade = 'oanda.trade',
  OandaTransaction = 'oanda.transaction',
}

export enum TimeFormats {
  LA = 'America/Los_Angeles',
  NY = 'America/New_York',
  HumanFull = 'M/D HH:mm:ss',
  HumanTime = 'HH:mm:ss',
}
