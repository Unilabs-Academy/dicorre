import { shallowRef } from 'vue'
import { Effect, Fiber } from 'effect'
import type { DicomFile } from '@/types/dicom'
import type { RuntimeType } from '@/types/effects'
import { FileHandler } from '@/services/fileHandler'
import { DicomProcessor } from '@/services/dicomProcessor'
import { OPFSStorage } from '@/services/opfsStorage'

export type TaskStatus = 'running' | 'success' | 'error' | 'cancelled'

export interface Task {
  taskId: string
  fileName: string
  currentStep: string
  progress: number
  status: TaskStatus
  startTime: number
  endTime?: number
  error?: string
}

export function useFileProcessing(runtime: RuntimeType) {
  const tasks = shallowRef<Map<string, Task>>(new Map())
  const fibers = shallowRef<Map<string, Fiber.RuntimeFiber<DicomFile[], Error>>>(new Map())
  const readingTickers = new Map<string, () => void>()

  const setTask = (taskId: string, patch: Partial<Task>) => {
    const prev = tasks.value.get(taskId)
    if (!prev) return
    tasks.value.set(taskId, { ...prev, ...patch })
    tasks.value = new Map(tasks.value)
  }

  const addTask = (task: Task) => {
    tasks.value.set(task.taskId, task)
    tasks.value = new Map(tasks.value)
  }

  const removeTask = (taskId: string) => {
    if (!tasks.value.has(taskId)) return
    tasks.value.delete(taskId)
    tasks.value = new Map(tasks.value)
  }

  const saveAllToOpfs = (files: DicomFile[], onProgress: (i: number, file: DicomFile) => void) =>
    Effect.gen(function* () {
      const opfs = yield* OPFSStorage
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        yield* opfs.saveFile(f.id, f.arrayBuffer)
        const exists = yield* opfs.fileExists(f.id)
        if (!exists) {
          return yield* Effect.fail(new Error(`Failed to verify file in storage: ${f.fileName}`))
        }
        // Enforce OPFS as source of truth in memory
        f.opfsFileId = f.id
        f.arrayBuffer = new ArrayBuffer(0)
        onProgress(i + 1, f)
      }
      return files
    })

  const startTask = (
    file: File,
    options: {
      isAppReady: boolean
      parseConcurrency: number
      onAppendFiles?: (files: DicomFile[]) => void
    }
  ) => {
    if (!options.isAppReady) {
      const id = `${file.name}-${Date.now()}-not-ready`
      addTask({
        taskId: id,
        fileName: file.name,
        currentStep: 'Configuration not loaded',
        progress: 100,
        status: 'error',
        startTime: Date.now(),
        endTime: Date.now(),
        error: 'Configuration not loaded'
      })
      // Keep error tasks visible until user closes them
      return id
    }

    const taskId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    addTask({
      taskId,
      fileName: file.name,
      currentStep: `Reading ${file.name}`,
      progress: 0,
      status: 'running',
      startTime: Date.now()
    })

    const effect = Effect.gen(function* () {
      const fileHandler = yield* FileHandler
      const processor = yield* DicomProcessor
      let readingInterval: number | null = null
      let readingProgress = 0
      const maxReadingProgress = 60
      const startReadingTicker = () => {
        if (readingInterval !== null) return
        readingInterval = setInterval(() => {
          readingProgress = Math.min(readingProgress + 1, maxReadingProgress)
          setTask(taskId, { progress: readingProgress, currentStep: `Reading ${file.name}` })
          if (readingProgress >= maxReadingProgress && readingInterval !== null) {
            clearInterval(readingInterval)
            readingInterval = null
          }
        }, 200) as unknown as number
      }
      const stopReadingTicker = () => {
        if (readingInterval !== null) {
          clearInterval(readingInterval)
          readingInterval = null
        }
        readingTickers.delete(taskId)
      }
      readingTickers.set(taskId, stopReadingTicker)

      // Start smooth progress during file reading
      startReadingTicker()
      const processed = yield* fileHandler.processFile(file)
      // Stop ticker as soon as reading completes
      stopReadingTicker()
      // Ensure progress reflects completed reading phase
      setTask(taskId, { progress: Math.max(readingProgress, maxReadingProgress), currentStep: `Parsing ${processed.length} file(s)…` })
      if (processed.length === 0) {
        setTask(taskId, { status: 'error', error: 'No DICOM files found', progress: 100, currentStep: 'No files', endTime: Date.now() })
        return []
      }

      const parsed = yield* processor.parseFiles(processed, options.parseConcurrency, {
        onProgress: (completed: number, total: number, current?: DicomFile) => {
          const p = Math.min(maxReadingProgress + Math.round((completed / total) * 30), 90)
          setTask(taskId, { progress: p, currentStep: `Parsing: ${current?.fileName ?? 'processing…'}` })
        }
      })
      if (parsed.length === 0) {
        setTask(taskId, { status: 'error', error: 'Parse failed', progress: 100, currentStep: 'Parse failed', endTime: Date.now() })
        return []
      }

      setTask(taskId, { currentStep: 'Processing files…', progress: 90 })
      const saved = yield* saveAllToOpfs(parsed, (i, f) => {
        const p = 90 + Math.round((i / parsed.length) * 10)
        setTask(taskId, { progress: Math.min(p, 100), currentStep: `Processing: ${f.fileName}` })
      })

      options.onAppendFiles?.(saved)

      setTask(taskId, { status: 'success', progress: 100, currentStep: `Done (${saved.length})`, endTime: Date.now() })
      setTimeout(() => removeTask(taskId), 0)
      return saved
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const stop = readingTickers.get(taskId)
          if (stop) stop()
          setTask(taskId, {
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
            progress: 100,
            currentStep: 'Failed',
            endTime: Date.now()
          })
          // Keep error tasks visible until user closes them
          return []
        })
      ),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          const stop = readingTickers.get(taskId)
          if (stop) stop()
          setTask(taskId, {
            status: 'cancelled',
            currentStep: 'Cancelled',
            progress: 100,
            endTime: Date.now(),
            error: 'Processing was cancelled'
          })
          setTimeout(() => removeTask(taskId), 2000)
        })
      )
    )

    const fiber = runtime.runFork(effect)
    fibers.value.set(taskId, fiber)
    fibers.value = new Map(fibers.value)
    runtime.runPromise(Fiber.join(fiber)).finally(() => {
      fibers.value.delete(taskId)
      fibers.value = new Map(fibers.value)
    })

    return taskId
  }

  const addFiles = (
    files: File[],
    options: {
      isAppReady: boolean
      parseConcurrency: number
      onAppendFiles?: (files: DicomFile[]) => void
    }
  ) => files.map((f) => startTask(f, options))

  const getAllTasks = () => Array.from(tasks.value.values())
  const getRunningTasks = () => getAllTasks().filter((t) => t.status === 'running')
  const hasActiveProcessing = () => getRunningTasks().length > 0
  const hasActiveOperations = () => fibers.value.size > 0

  const cancelTask = (taskId: string) => {
    const fiber = fibers.value.get(taskId)
    if (!fiber) return
    Effect.runSync(Fiber.interrupt(fiber))
  }

  const cancelAll = () => {
    for (const [_id, fiber] of fibers.value.entries()) {
      Effect.runSync(Fiber.interrupt(fiber))
    }
  }

  const clearAllTasks = () => {
    tasks.value = new Map()
  }

  return {
    tasks,
    addFiles,
    startTask,
    cancelTask,
    cancelAll,
    getAllTasks,
    getRunningTasks,
    hasActiveProcessing,
    hasActiveOperations,
    clearAllTasks
  }
}
