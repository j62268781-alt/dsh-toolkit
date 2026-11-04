import s from '@deepseek-ai/schemastery'

// Flat volatile leaves can be written independently by DSH ConfigForms.
export const Config = s.object({
  enabled: s.boolean().default(true).volatile(),
  soundEnabled: s.boolean().default(true).volatile(),
  volume: s.number().min(0).max(1).default(1).volatile(),
  currentMode: s.union(['never', 'unfocused', 'always', 'hidden']).default('unfocused').volatile(),
  sound: s.string().default('system').volatile(),
  scope: s.union(['all', 'main', 'main-wait']).default('main-wait').volatile(),
  completedEnabled: s.boolean().default(true).volatile(),
  completedSound: s.string().default('chime').volatile(),
  failedEnabled: s.boolean().default(true).volatile(),
  failedSound: s.string().default('fault').volatile(),
  questionEnabled: s.boolean().default(true).volatile(),
  questionSound: s.string().default('pop').volatile(),
  permissionEnabled: s.boolean().default(true).volatile(),
  permissionSound: s.string().default('alert').volatile(),
})
