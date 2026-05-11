import { Context, Effect } from 'effect'
import type { ReceiptVerificationRecord } from './index'

export class ReceiptVerificationPersistence extends Context.Tag('ReceiptVerificationPersistence')<
  ReceiptVerificationPersistence,
  {
    readonly load: Effect.Effect<Map<string, ReceiptVerificationRecord> | null, never>
    readonly save: (records: Map<string, ReceiptVerificationRecord>) => Effect.Effect<void, never>
    readonly clear: Effect.Effect<void, never>
  }
>() {}
