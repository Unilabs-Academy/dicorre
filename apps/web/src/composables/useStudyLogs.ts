import { computed, shallowRef, inject, onMounted, onUnmounted } from 'vue'
import { Effect, Stream } from 'effect'
import type { RuntimeType } from '@/types/effects'
import { StudyLogger, type StudyLogEntry } from '@/services/studyLogger'

export function useStudyLogs(runtimeArg?: RuntimeType) {
  const runtime = runtimeArg ?? inject<RuntimeType>('appRuntime')!
  const logsMap = shallowRef<Map<string, StudyLogEntry[]>>(new Map())
  let fiber: any = null

  // Subscribe to logs changes stream
  onMounted(() => {
    const stream = Effect.gen(function* () {
      const logger = yield* StudyLogger
      yield* Stream.runForEach(
        logger.logsChanges,
        (logs) => Effect.sync(() => {
          logsMap.value = new Map(logs)
        })
      )
    })
    
    fiber = runtime.runFork(stream)
  })

  onUnmounted(() => {
    if (fiber) {
      runtime.runPromise(fiber.interrupt)
    }
  })

  const getLogs = async (studyId: string) => {
    const entries = await runtime.runPromise(Effect.gen(function* () {
      const logger = yield* StudyLogger
      return yield* logger.get(studyId)
    }))
    // Update will happen automatically via the stream
    return entries
  }

  const logsFor = (studyId: string) => computed(() => logsMap.value.get(studyId) ?? [])

  return { getLogs, logsFor }
}


