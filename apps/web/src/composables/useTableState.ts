import { ref, computed } from 'vue'
import type { ColumnFiltersState, SortingState, VisibilityState } from '@tanstack/vue-table'
import type { DicomStudy } from '@/types/dicom'

const sorting = ref<SortingState>([])
const columnFilters = ref<ColumnFiltersState>([])
const columnVisibility = ref<VisibilityState>({})
const rowSelection = ref<Record<string, boolean>>({})

export function useTableState() {

  const getSelectedStudies = (data: DicomStudy[]): DicomStudy[] => {
    return Object.keys(rowSelection.value)
      .filter(key => rowSelection.value[key])
      .map(studyUID => data.find(study => study.studyInstanceUID === studyUID))
      .filter((study): study is DicomStudy => study !== undefined)
  }

  const clearSelection = () => {
    rowSelection.value = {}
  }

  const isAllSelectedAnonymized = computed(() => {
    const selectedIndexes = Object.keys(rowSelection.value).filter(key => rowSelection.value[key])
    if (selectedIndexes.length === 0) return false

    // This will be computed based on the actual data passed in
    return false
  })

  return {
    sorting,
    columnFilters,
    columnVisibility,
    rowSelection,
    getSelectedStudies,
    clearSelection,
    isAllSelectedAnonymized
  }
}
