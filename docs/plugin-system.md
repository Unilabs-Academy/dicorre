# Plugin System

The plugin system allows extending the DICOM anonymization tool with custom file format converters and processing hooks.

## Architecture

### Plugin Types

**File Format Plugins** - Convert non-DICOM files to DICOM format:
```typescript
interface FileFormatPlugin extends Plugin {
  type: 'file-format'
  supportedExtensions: string[]
  canProcess: (file: File) => Effect.Effect<boolean, PluginError>
  convertToDicom: (file: File, options?: ConversionOptions) => Effect.Effect<DicomFile[], PluginError>
}
```

**Hook Plugins** - Execute custom logic during processing:
```typescript
interface HookPlugin extends Plugin {
  type: 'hook'
  hooks: PluginHooks
}

interface PluginHooks {
  beforeSend?: (study: DicomStudy) => Effect.Effect<void, PluginError>
  afterSend?: (study: DicomStudy) => Effect.Effect<void, PluginError>
  onSendError?: (study: DicomStudy, error: unknown) => Effect.Effect<void, PluginError>
}
```

### Plugin Registry

The `PluginRegistry` service manages plugin lifecycle using Effect's dependency injection:

```typescript
// Register plugins
yield* registry.registerPlugin(imageConverterPlugin)

// Find plugin for file
const plugin = yield* registry.getPluginForFile(jpgFile)

// Get plugins by type
const filePlugins = yield* registry.getFileFormatPlugins()
```

## Built-in Plugins

### Image Converter
Converts JPG/PNG/BMP files to DICOM Secondary Capture:
- Extracts RGB pixel data using Canvas API
- Creates DICOM dataset with dcmjs
- Supports configurable modality and patient info

### Send Logger
Logs DICOM send operations to console:
- beforeSend: Logs study details before transmission
- afterSend: Logs successful transmission
- onSendError: Logs transmission errors

### Receipt Verifier
Verifies that a successfully sent study is visible in a receiving system:
- afterSend: Runs only after all files in a study send successfully
- Providers: generic DICOMweb/QIDO, Orthanc via DICOMweb, and PACScenter
- Results: Persisted separately from send success and shown in CLI JSON and the web `Received` column

## Configuration

Enable plugins in `app.config.json`:

```json
{
  "plugins": {
    "enabled": ["image-converter", "send-logger", "receipt-verifier"],
    "settings": {
      "image-converter": {
        "defaultModality": "OT"
      },
      "receipt-verifier": {
        "provider": "dicomweb-qido",
        "url": "http://127.0.0.1:8080/dicom-web",
        "timeoutMs": 60000
      }
    }
  }
}
```

## Integration

Plugins integrate with the FileHandler service:

```typescript
// FileHandler checks plugins for non-DICOM files
const processFile = (file: File): Effect.Effect<DicomFile[], FileHandlerErrorType, PluginRegistry> =>
  Effect.gen(function* () {
    // Try ZIP extraction, DICOM validation, then plugins
    const plugin = yield* PluginRegistry.getPluginForFile(file)
    if (plugin) {
      return yield* plugin.convertToDicom(file)
    }
    return []
  })
```

## Development

Create new plugins by implementing the plugin interfaces and registering them with the PluginRegistry. All plugins use Effect for error handling and dependency injection.

File locations:
- Plugin types: `/src/types/plugins.ts`
- Plugin registry: `/src/services/pluginRegistry/`
- Example plugins: `/src/plugins/`
