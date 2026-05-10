import type { ColumnDef } from '@tanstack/vue-table'
import type { DicomStudy } from '@/types/dicom'
import { h } from 'vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowUp, ArrowDown, Edit, FileSearch, FileText } from 'lucide-vue-next'
import StudyProgressIndicator from '@/components/StudyProgressIndicator.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export const columns: ColumnDef<DicomStudy>[] = [
  {
    id: 'select',
    header: ({ table }) => h(Checkbox, {
      'modelValue': table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate'),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!value),
      'ariaLabel': 'Select all',
    }),
    cell: ({ row }) => h(Checkbox, {
      'modelValue': row.getIsSelected(),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(!!value),
      'ariaLabel': 'Select row',
    }),
    enableSorting: false,
    enableHiding: false,
  },
  {
    id: 'actions',
    header: () => null,
    cell: ({ row, table }) => {
      const study = row.original
      const hasCustomFields = study.customFields && Object.keys(study.customFields).length > 0

      return h(DropdownMenu as any, {}, {
        default: () => [
          h(DropdownMenuTrigger as any, { asChild: true }, () => [
            h(Button as any, {
              variant: hasCustomFields ? 'outline' : 'ghost',
              size: 'icon-sm',
              'data-testid': `actions-menu-${study.id}`
            }, () => '⋯')
          ]),
          h(DropdownMenuContent as any, { align: 'start' }, () => [
            h(DropdownMenuItem as any, {
              onClick: () => {
                const open = (table.options.meta as any)?.openCustomFieldsForStudy
                if (open) open(study)
              },
              class: hasCustomFields ? 'font-semibold' : ''
            }, () => [
              h('div', { class: 'flex items-center gap-2' }, [
                h(Edit, {
                  class: hasCustomFields ? 'h-4 w-4 text-primary' : 'h-4 w-4'
                }),
                h('span', {}, 'Edit custom fields')
              ])
            ]),
            h(DropdownMenuItem as any, {
              onClick: () => {
                const openMeta = (table.options.meta as any)?.openMetadataForStudy
                if (openMeta) openMeta(study)
              },
              'data-testid': `view-dicom-metadata-${study.id}`
            }, () => [
              h('div', { class: 'flex items-center gap-2' }, [
                h(FileSearch, { class: 'h-4 w-4' }),
                h('span', {}, 'Inspect DICOM metadata')
              ])
            ]),
            h(DropdownMenuItem as any, {
              onClick: () => {
                const openLog = (table.options.meta as any)?.openLogForStudy
                if (openLog) openLog(study)
              },
              'data-testid': `view-log-${study.id}`
            }, () => [
              h('div', { class: 'flex items-center gap-2' }, [
                h(FileText, { class: 'h-4 w-4' }),
                h('span', {}, 'View log')
              ])
            ])
          ])
        ]
      })
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'accessionNumber',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-0 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Accession Number'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'px-0 ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const accessionNumber = row.getValue('accessionNumber') as string
      return h('div', { class: 'font-medium -ml-2', 'data-testid': 'cell-accession-number' }, accessionNumber || 'Unknown Accession Number')
    },
  },
  {
    accessorKey: 'patientId',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Patient ID'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const patientId = row.getValue('patientId') as string
      return h('div', { class: 'text-muted-foreground', 'data-testid': 'cell-patient-id' }, patientId || 'Unknown')
    },
  },
  {
    accessorKey: 'studyDate',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Study Date'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const date = row.getValue('studyDate') as string
      if (date && date.length === 8) {
        // Format YYYYMMDD to YYYY-MM-DD
        const formatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        return h('div', formatted)
      }
      return h('div', { class: 'text-muted-foreground' }, '-')
    },
  },
  {
    accessorKey: 'studyDescription',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Study Description'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const description = row.getValue('studyDescription') as string
      return h('div', { class: 'max-w-[200px] truncate' }, description || 'No description')
    },
  },
  {
    id: 'seriesCount',
    accessorFn: row => row.series.length,
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Series'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      return h(Badge, { variant: 'secondary' }, () => study.series.length.toString())
    },
  },
  {
    id: 'fileCount',
    accessorFn: row => row.series.reduce((sum, s) => sum + s.files.length, 0),
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Files'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      const fileCount = study.series.reduce((sum, s) => sum + s.files.length, 0)
      return h(Badge, { variant: 'outline' }, () => fileCount.toString())
    },
  },
  {
    accessorKey: 'studyInstanceUID',
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Study UID'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const uid = row.getValue('studyInstanceUID') as string
      return h('div', {
        class: 'font-mono text-xs text-muted-foreground max-w-[150px] truncate',
        title: uid
      }, uid)
    },
  },
  {
    id: 'anonymized',
    accessorFn: row => {
      const totalFiles = row.series.reduce((sum, s) => sum + s.files.length, 0)
      const anonymizedFiles = row.series.reduce((sum, s) => sum + s.files.filter(f => f.anonymized).length, 0)
      return totalFiles > 0 ? (anonymizedFiles / totalFiles) : 0
    },
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Anonymized'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      const totalFiles = study.series.reduce((sum, s) => sum + s.files.length, 0)
      const anonymizedFiles = study.series.reduce((sum, s) => sum + s.files.filter(f => f.anonymized).length, 0)

      return h(StudyProgressIndicator, {
        studyId: study.studyInstanceUID,
        totalFiles,
        anonymizedFiles,
        showOnly: 'anonymization',
        'data-testid': 'cell-anonymized'
      })
    },
  },
  {
    id: 'sent',
    accessorFn: row => {
      const totalFiles = row.series.reduce((sum, s) => sum + s.files.length, 0)
      const sentFiles = row.series.reduce((sum, s) => sum + s.files.filter(f => f.sent).length, 0)
      return totalFiles > 0 ? (sentFiles / totalFiles) : 0
    },
    header: ({ column }) => {
      return h(Button, {
        variant: 'ghost',
        class: '-mx-2 px-2 h-auto font-normal hover:bg-transparent flex items-center',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc'),
      }, () => [
        h('span', {}, 'Sent'),
        column.getIsSorted() ? h(
          column.getIsSorted() === 'asc' ? ArrowUp : ArrowDown,
          { class: 'ml-1 h-3 w-3 opacity-50' }
        ) : null
      ])
    },
    cell: ({ row }) => {
      const study = row.original
      const totalFiles = study.series.reduce((sum, s) => sum + s.files.length, 0)
      const sentFiles = study.series.reduce((sum, s) => sum + s.files.filter(f => f.sent).length, 0)

      return h(StudyProgressIndicator, {
        studyId: study.studyInstanceUID,
        totalFiles,
        sentFiles,
        showOnly: 'sending',
        'data-testid': 'cell-sent'
      })
    },
  },
]
