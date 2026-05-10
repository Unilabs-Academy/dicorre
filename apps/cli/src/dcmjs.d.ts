declare module 'dcmjs' {
  export namespace data {
    export class DicomMessage {
      static readFile(buffer: ArrayBuffer): DicomMessage
      static write(dict: any): ArrayBuffer
      constructor(dict: any)
      dict: any
      meta?: any
      write(options?: any): ArrayBuffer
    }

    export class DicomDict {
      constructor(meta: any)
      dict: any
      write(options?: any): ArrayBuffer
    }

    export class DicomMetaDictionary {
      static naturalizeDataset(dict: any): any
      static uid(): string
    }
  }
}
