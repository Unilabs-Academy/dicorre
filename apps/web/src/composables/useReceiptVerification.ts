import { computed, inject, onMounted, onUnmounted, shallowRef } from 'vue'
import { Effect, Stream } from 'effect'
import { ReceiptVerificationService, type ReceiptVerificationRecord } from '@/services/receiptVerification'
import type { RuntimeType } from '@/types/effects'

export function useReceiptVerification(runtimeArg?: RuntimeType) {
  const runtime = runtimeArg ?? inject<RuntimeType>('appRuntime')!
  const recordsMap = shallowRef<Map<string, ReceiptVerificationRecord>>(new Map())
  let fiber: any = null

  onMounted(() => {
    const stream = Effect.gen(function* () {
      const receiptVerification = yield* ReceiptVerificationService
      const initial = yield* receiptVerification.getAll
      yield* Effect.sync(() => {
        recordsMap.value = new Map(initial)
      })
      yield* Stream.runForEach(
        receiptVerification.recordsChanges,
        (records) => Effect.sync(() => {
          recordsMap.value = new Map(records)
        })
      )
    })

    fiber = runtime.runFork(stream)
  })

  onUnmounted(() => {
    if (fiber) void runtime.runPromise(fiber.interrupt)
  })

  const recordFor = (studyInstanceUID: string) => computed(() => recordsMap.value.get(studyInstanceUID))

  return { recordsMap, recordFor }
}
