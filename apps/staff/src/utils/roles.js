// Central role definitions used for route guards and role-aware UI.
export const ROLES = {
  ADMIN: 'admin',
  MPDC: 'mpdc',
  ENGINEERING: 'engineering',
  BAC: 'bac',
}

export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Administrator',
  [ROLES.MPDC]: 'MPDC',
  [ROLES.ENGINEERING]: 'Engineering Office',
  [ROLES.BAC]: 'BAC',
}

export const ROLE_HOME_PATH = {
  [ROLES.ADMIN]: '/admin',
  [ROLES.MPDC]: '/mpdc',
  [ROLES.ENGINEERING]: '/engineering',
  [ROLES.BAC]: '/bac',
}
