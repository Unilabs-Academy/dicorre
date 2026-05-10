import { ref, type Ref } from 'vue'

/**
 * Utility to handle the transition from dropdown menu to sheet/dialog opening.
 * This prevents the sheet from immediately closing when triggered from a dropdown.
 *
 * The issue: When opening a sheet from a dropdown menu item, the dropdown's close
 * event can propagate and close the newly opened sheet immediately.
 *
 * The solution: Use a suppress flag to ignore close events for a short period,
 * and defer the sheet opening to the next tick.
 */

export interface DropdownSheetTransition {
  suppressClose: Ref<boolean>
  openWithTransition: (callback: () => void) => void
  handleUpdateOpen: (value: boolean, openRef: Ref<boolean>) => void
}

/**
 * Creates a transition handler for opening sheets/dialogs from dropdown menus
 */
export function useDropdownSheetTransition(): DropdownSheetTransition {
  const suppressClose = ref(false)

  /**
   * Opens a sheet with proper transition handling from dropdown
   * @param callback - Function to execute to open the sheet
   */
  function openWithTransition(callback: () => void) {
    suppressClose.value = true
    setTimeout(() => { suppressClose.value = false }, 200)
    setTimeout(() => { callback() }, 0)
  }

  /**
   * Handles the update:open event from the sheet/dialog
   * @param value - The new open state
   * @param openRef - The ref controlling the sheet's open state
   */
  function handleUpdateOpen(value: boolean, openRef: Ref<boolean>) {
    if (!value && suppressClose.value) return
    openRef.value = value
  }

  return {
    suppressClose,
    openWithTransition,
    handleUpdateOpen
  }
}

/**
 * Standalone function for simple dropdown-to-sheet transitions
 * Use this when you don't need to handle the sheet's update:open event
 */
export function deferForDropdown(callback: () => void) {
  setTimeout(callback, 0)
}
