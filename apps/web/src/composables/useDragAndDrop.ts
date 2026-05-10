import { ref } from 'vue'

export function useDragAndDrop() {
  // Drag and drop state
  const isDragOver = ref(false)
  const isGlobalDragOver = ref(false)
  const dragCounter = ref(0)

  const extractDroppedFiles = async (dataTransfer: DataTransfer | null): Promise<{ files: File[]; isDirectoryDrop: boolean; zipName?: string }> => {
    if (!dataTransfer) return { files: [], isDirectoryDrop: false }

    type DroppedItem = { file: File; relativePath: string }
    const collected: DroppedItem[] = []
    const items = dataTransfer.items
    let sawDirectory = false
    const topLevelDirNames = new Set<string>()

    const looksLikeDirectoryPseudoFile = (file: File): boolean => {
      return file.size === 0 && file.type === '' && !file.name.includes('.')
    }

    const shouldSkipSystemFile = (name: string): boolean => {
      const lower = name.toLowerCase()
      return lower.endsWith('.ds_store') || lower.endsWith('thumbs.db') || lower.endsWith('desktop.ini') || lower === '.gitkeep' || lower === '.gitignore'
    }

    const addFile = (file: File | null | undefined, relativePath: string) => {
      if (!file) return
      if (looksLikeDirectoryPseudoFile(file)) return
      if (shouldSkipSystemFile(relativePath)) return
      collected.push({ file, relativePath })
    }

    const traverseFsHandle = async (handle: any, pathPrefix: string): Promise<void> => {
      try {
        if (!handle) return
        if (handle.kind === 'file') {
          const file: File = await handle.getFile()
          addFile(file, pathPrefix ? `${pathPrefix}/${file.name}` : file.name)
        } else if (handle.kind === 'directory') {
          sawDirectory = true
          if (pathPrefix === '') topLevelDirNames.add(handle.name)
          for await (const child of handle.values()) {
            const nextPrefix = pathPrefix ? `${pathPrefix}/${child.name}` : child.name
            await traverseFsHandle(child, nextPrefix)
          }
        }
      } catch {
        // Ignore handles we cannot access
      }
    }

    const readAllEntries = (dirReader: any): Promise<any[]> => {
      return new Promise((resolve) => {
        const entries: any[] = []
        const readBatch = () => {
          dirReader.readEntries((batch: any[]) => {
            if (batch.length === 0) {
              resolve(entries)
              return
            }
            entries.push(...batch)
            readBatch()
          }, () => resolve(entries))
        }
        readBatch()
      })
    }

    const traverseWebkitEntry = async (entry: any): Promise<void> => {
      if (!entry) return
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file((file: File) => {
            const fullPath: string = typeof entry.fullPath === 'string' ? entry.fullPath.replace(/^\//, '') : file.name
            if (fullPath.split('/').length > 1) {
              topLevelDirNames.add(fullPath.split('/')[0] || '')
            }
            addFile(file, fullPath)
            resolve()
          }, () => resolve())
        })
      } else if (entry.isDirectory) {
        sawDirectory = true
        if (entry.name) topLevelDirNames.add(entry.name)
        const reader = entry.createReader()
        const children = await readAllEntries(reader)
        for (const child of children) {
          await traverseWebkitEntry(child)
        }
      }
    }

    if (items && items.length > 0) {
      const tasks: Promise<void>[] = []
      for (let i = 0; i < items.length; i++) {
        const item: any = items[i]
        if (typeof item.getAsFileSystemHandle === 'function') {
          tasks.push(
            (async () => {
              try {
                const handle = await item.getAsFileSystemHandle()
                if (handle.kind === 'directory') sawDirectory = true
                const startPrefix = handle.kind === 'directory' ? handle.name : ''
                if (startPrefix) topLevelDirNames.add(startPrefix)
                await traverseFsHandle(handle, startPrefix)
              } catch {
                // Ignore; some browsers may not permit handle access
              }
            })()
          )
        } else if (typeof item.webkitGetAsEntry === 'function') {
          const entry = item.webkitGetAsEntry()
          if (entry) tasks.push(traverseWebkitEntry(entry))
        } else if (item.kind === 'file' && typeof item.getAsFile === 'function') {
          const file = item.getAsFile()
          if (file && !looksLikeDirectoryPseudoFile(file) && !shouldSkipSystemFile(file.name)) {
            addFile(file, file.name)
          }
        }
      }
      await Promise.all(tasks)
      // If any directory was present, bundle into a single in-memory ZIP to create one processing task
      if (sawDirectory) {
        const jszip = await import('jszip')
        const zip = new jszip.default()
        for (const { file, relativePath } of collected) {
          // Preserve relative paths inside the archive
          try {
            const buf = await file.arrayBuffer()
            zip.file(relativePath, buf)
          } catch {
            // Skip unreadable file
          }
        }
        const blob = await zip.generateAsync({ type: 'blob' })
        const baseName = topLevelDirNames.size === 1 ? `${Array.from(topLevelDirNames)[0]}.zip` : 'dropped-files.zip'
        const zipFile = new File([blob], baseName, { type: 'application/zip' })
        return { files: [zipFile], isDirectoryDrop: true, zipName: baseName }
      }
      // No directories: return plain files
      return { files: collected.map(c => c.file), isDirectoryDrop: false }
    }

    const files = dataTransfer.files
    if (files && files.length > 0) {
      const filtered = Array.from(files).filter((f) => !looksLikeDirectoryPseudoFile(f) && !shouldSkipSystemFile(f.name))
      return { files: filtered, isDirectoryDrop: false }
    }
    return { files: [], isDirectoryDrop: false }
  }

  // Local drag and drop handlers (for drop zone)
  const handleDrop = async (
    event: DragEvent,
    options: {
      onFilesAdded: (files: File[]) => void
      onProcessFiles: (files: File[]) => Promise<void>
    }
  ) => {
    event.preventDefault()
    isDragOver.value = false
    const result = await extractDroppedFiles(event.dataTransfer ?? null)
    const fileArray = result.files
    if (fileArray.length > 0) {
      options.onFilesAdded(fileArray)
      await options.onProcessFiles(fileArray)
    }
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    isDragOver.value = true
  }

  const handleDragLeave = () => {
    isDragOver.value = false
  }

  // Global drag and drop handlers (for whole page)
  const handleGlobalDragEnter = (event: DragEvent) => {
    event.preventDefault()
    dragCounter.value++
    if (event.dataTransfer?.types.includes('Files')) {
      isGlobalDragOver.value = true
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    event.preventDefault()
    dragCounter.value--
    if (dragCounter.value === 0) {
      isGlobalDragOver.value = false
    }
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    event.preventDefault()
  }

  const handleGlobalDrop = async (
    event: DragEvent,
    options: {
      onFilesAdded: (files: File[]) => void
      onProcessFiles: (files: File[]) => Promise<void>
    }
  ) => {
    event.preventDefault()
    dragCounter.value = 0
    isGlobalDragOver.value = false
    const result = await extractDroppedFiles(event.dataTransfer ?? null)
    const fileArray = result.files
    if (fileArray.length > 0) {
      options.onFilesAdded(fileArray)
      await options.onProcessFiles(fileArray)
    }
  }

  // File input handler
  const handleFileInput = async (
    event: Event,
    options: {
      onFilesAdded: (files: File[]) => void
      onProcessFiles: (files: File[]) => Promise<void>
    }
  ) => {
    const target = event.target as HTMLInputElement
    if (target.files) {
      const files = Array.from(target.files)
      options.onFilesAdded(files)

      // Auto-process only the new files
      await options.onProcessFiles(files)
    }
  }

  const resetDragState = () => {
    isDragOver.value = false
    isGlobalDragOver.value = false
    dragCounter.value = 0
  }

  return {
    // State
    isDragOver,
    isGlobalDragOver,
    dragCounter,
    // Event handlers
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleGlobalDragEnter,
    handleGlobalDragLeave,
    handleGlobalDragOver,
    handleGlobalDrop,
    handleFileInput,
    // Utilities
    resetDragState
  }
}
