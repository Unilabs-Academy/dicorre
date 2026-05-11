<script setup lang="ts" generic="TData, TValue">
import { useTableState } from '@/composables/useTableState'
import type { ColumnDef } from '@tanstack/vue-table'
import {
  FlexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useVueTable,
} from '@tanstack/vue-table'

import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const props = defineProps<{
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  openCustomFieldsForStudy?: (row: TData) => void
  openLogForStudy?: (row: TData) => void
  openMetadataForStudy?: (row: TData) => void
}>()

const {
  sorting,
  columnFilters,
  columnVisibility,
  rowSelection,
} = useTableState()

const table = useVueTable({
  get data() {
    return props.data
  },
  get columns() {
    return props.columns
  },
  meta: {
    openCustomFieldsForStudy: (row: TData) => props.openCustomFieldsForStudy?.(row),
    openLogForStudy: (row: TData) => props.openLogForStudy?.(row),
    openMetadataForStudy: (row: TData) => props.openMetadataForStudy?.(row)
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  enableRowSelection: true,
  getRowId: (row: any) => row.studyInstanceUID, // Use stable ID based on study UID
  onSortingChange: sorting.value ? (updaterOrValue) => {
    sorting.value = typeof updaterOrValue === 'function'
      ? updaterOrValue(sorting.value)
      : updaterOrValue
  } : undefined,
  onColumnFiltersChange: columnFilters.value ? (updaterOrValue) => {
    columnFilters.value = typeof updaterOrValue === 'function'
      ? updaterOrValue(columnFilters.value)
      : updaterOrValue
  } : undefined,
  onColumnVisibilityChange: columnVisibility.value ? (updaterOrValue) => {
    columnVisibility.value = typeof updaterOrValue === 'function'
      ? updaterOrValue(columnVisibility.value)
      : updaterOrValue
  } : undefined,
  onRowSelectionChange: (updaterOrValue) => {
    rowSelection.value = typeof updaterOrValue === 'function'
      ? updaterOrValue(rowSelection.value)
      : updaterOrValue
  },
  state: {
    get sorting() {
      return sorting.value ?? []
    },
    get columnFilters() {
      return columnFilters.value ?? []
    },
    get columnVisibility() {
      return columnVisibility.value ?? {}
    },
    get rowSelection() {
      return rowSelection.value ?? {}
    },
  },
})
</script>

<template>
  <div class="w-full">
    <div class="flex items-center py-4">
      <Input
        placeholder="Search by accession number..."
        :model-value="(table.getColumn('accessionNumber')?.getFilterValue() as string) ?? ''"
        @update:model-value="table.getColumn('accessionNumber')?.setFilterValue($event)"
        class="max-w-sm"
      />
      <div class="ml-auto text-sm text-muted-foreground">
        {{ table.getFilteredSelectedRowModel().rows.length }} of {{ table.getFilteredRowModel().rows.length }} row(s)
        selected
      </div>
    </div>
    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
          >
            <TableHead
              v-for="header in headerGroup.headers"
              :key="header.id"
            >
              <FlexRender
                v-if="!header.isPlaceholder"
                :render="header.column.columnDef.header"
                :props="header.getContext()"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="table.getRowModel().rows?.length">
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :data-state="row.getIsSelected() && 'selected'"
            >
              <TableCell
                v-for="cell in row.getVisibleCells()"
                :key="cell.id"
              >
                <FlexRender
                  :render="cell.column.columnDef.cell"
                  :props="cell.getContext()"
                />
              </TableCell>
            </TableRow>
          </template>

          <TableRow v-else>
            <TableCell
              :col-span="columns.length"
              class="h-24 text-center"
              data-testid="studies-data-table-empty"
            >
              No studies found.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
