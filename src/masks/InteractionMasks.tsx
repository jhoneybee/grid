import React, { useState, useRef, useEffect, useCallback } from 'react';

// Components
import CellMask from './CellMask';
import DragMask, { DraggedPosition } from './DragMask';
import EditorContainer from '../editors/EditorContainer2';
// import EditorContainer from '../editors/EditorContainer';
// import EditorPortal from '../editors/EditorPortal';

// Utils
import {
  // isCtrlKeyHeldDown,
  getSelectedDimensions as getDimensions,
  getNextSelectedCellPosition,
  canExitGrid,
  isSelectedCellEditable
} from '../utils';

// Types
import EventBus from '../EventBus';
import { UpdateActions, CellNavigationMode } from '../common/enums';
import { Position, Dimension, /*CommitEvent,*/ ColumnMetrics } from '../common/types';
import { CanvasProps } from '../Canvas';

export enum KeyCodes {
  Backspace = 8,
  Tab = 9,
  Enter = 13,
  Escape = 27,
  ArrowLeft = 37,
  ArrowUp = 38,
  ArrowRight = 39,
  ArrowDown = 40,
  Delete = 46,
  c = 67,
  v = 86
}

type SharedCanvasProps<R, K extends keyof R> = Pick<CanvasProps<R, K>,
| 'rows'
| 'rowHeight'
| 'enableCellAutoFocus'
| 'enableCellCopyPaste'
| 'enableCellDragAndDrop'
| 'cellNavigationMode'
| 'editorPortalTarget'
| 'onCheckCellIsEditable'
| 'onSelectedCellChange'
| 'onSelectedCellRangeChange'
| 'onRowsUpdate'
> & Pick<ColumnMetrics<R>, 'columns'>;

export interface InteractionMasksProps<R, K extends keyof R> extends SharedCanvasProps<R, K> {
  height: number;
  canvasRef: React.RefObject<HTMLDivElement>;
  scrollLeft: number;
  scrollTop: number;
  eventBus: EventBus;
  scrollToCell(cell: Position): void;
}

function isKeyboardNavigationEvent(e: React.KeyboardEvent<HTMLDivElement>): boolean {
  return [
    KeyCodes.ArrowLeft,
    KeyCodes.ArrowUp,
    KeyCodes.ArrowRight,
    KeyCodes.ArrowDown
  ].includes(e.keyCode);
}

export default function InteractionMasks<R, K extends keyof R>({
  columns,
  rows,
  rowHeight,
  eventBus,
  enableCellAutoFocus,
  // enableCellCopyPaste,
  enableCellDragAndDrop,
  editorPortalTarget,
  cellNavigationMode,
  canvasRef,
  scrollLeft,
  scrollTop,
  onSelectedCellChange,
  onCheckCellIsEditable,
  onRowsUpdate,
  scrollToCell
}: InteractionMasksProps<R, K>) {
  const [selectedPosition, setSelectedPosition] = useState<Position>(() => {
    if (enableCellAutoFocus && document.activeElement === document.body && columns.length > 0 && rows.length > 0) {
      return { idx: 0, rowIdx: 0 };
    }
    return { idx: -1, rowIdx: -1 };
  });
  const [copiedPosition, setCopiedPosition] = useState<Position & { value: unknown } | null>(null);
  const [draggedPosition, setDraggedPosition] = useState<DraggedPosition | null>(null);
  const [isEditorEnabled, setIsEditorEnabled] = useState(false);
  const selectionMaskRef = useRef<HTMLDivElement>(null);

  // Focus on the selection mask when the selected position is changed
  useEffect(() => {
    if (selectedPosition.rowIdx === -1 || selectedPosition.idx === -1) return;
    selectionMaskRef.current?.focus();
  }, [selectedPosition]);

  // Focus on the selection mask after the editor is closed
  useEffect(() => {
    if (isEditorEnabled) return;
    selectionMaskRef.current?.focus();
  }, [isEditorEnabled]);

  useEffect(() => {
    return eventBus.subscribe('SELECT_CELL', selectCell);
  });

  useEffect(() => {
    if (draggedPosition === null) return;
    const handleDragEnter = (overRowIdx: number) => {
      setDraggedPosition({ ...draggedPosition, overRowIdx });
    };
    return eventBus.subscribe('DRAG_ENTER', handleDragEnter);
  }, [draggedPosition, eventBus]);

  const closeEditor = useCallback((): void => {
    setIsEditorEnabled(false);
  }, []);

  // Reset the positions if the current values are no longer valid. This can happen if a column or row is removed
  if (selectedPosition.idx > columns.length || selectedPosition.rowIdx > rows.length) {
    setSelectedPosition({ idx: -1, rowIdx: -1 });
    setCopiedPosition(null);
    setDraggedPosition(null);
  }

  // function getEditorPosition() {
  //   if (!canvasRef.current) return null;
  //   const { left, top } = canvasRef.current.getBoundingClientRect();
  //   const { scrollTop: docTop, scrollLeft: docLeft } = document.scrollingElement || document.documentElement;
  //   const column = columns[selectedPosition.idx];
  //   return {
  //     left: left + docLeft + column.left - (column.frozen ? 0 : scrollLeft),
  //     top: top + docTop + selectedPosition.rowIdx * rowHeight - scrollTop
  //   };
  // }

  function getNextPosition(keyCode: number) {
    switch (keyCode) {
      case KeyCodes.ArrowUp:
        return { ...selectedPosition, rowIdx: selectedPosition.rowIdx - 1 };
      case KeyCodes.ArrowDown:
        return { ...selectedPosition, rowIdx: selectedPosition.rowIdx + 1 };
      case KeyCodes.ArrowLeft:
        return { ...selectedPosition, idx: selectedPosition.idx - 1 };
      case KeyCodes.ArrowRight:
        return { ...selectedPosition, idx: selectedPosition.idx + 1 };
      default:
        return selectedPosition;
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const canOpenEditor = !isEditorEnabled && isCellEditable(selectedPosition);
    const { onCellInput } = columns[selectedPosition.idx];

    if (canOpenEditor && typeof onCellInput === 'function') {
      const column = columns[selectedPosition.idx];

      const enableEditor = onCellInput({
        column,
        row: rows[selectedPosition.rowIdx],
        event,
        onChange(rowUpdate) {
          onRowsUpdate({
            cellKey: column.key,
            fromRow: selectedPosition.rowIdx,
            toRow: selectedPosition.rowIdx,
            updated: rowUpdate as never, // TODO: fix type, or data structure
            action: UpdateActions.CELL_UPDATE
          });
        }
      });

      if (typeof enableEditor === 'boolean') {
        setIsEditorEnabled(enableEditor);
        return;
      }
    }

    const { key } = event;
    // TODO: move paste control to onCellInput?
    // if (isCtrlKeyHeldDown(e)) {
    //   onPressKeyWithCtrl(e);
    if (key === 'Escape') {
      closeEditor();
      setCopiedPosition(null);
    } else if (key === 'Tab') {
      onPressTab(event);
    } else if (isKeyboardNavigationEvent(event)) {
      changeCellFromEvent(event);
    } else if (canOpenEditor && key === 'Enter') {
      setIsEditorEnabled(true);
    }
  }

  // function onPressKeyWithCtrl({ keyCode }: React.KeyboardEvent<HTMLDivElement>): void {
  //   if (!enableCellCopyPaste) return;
  //   if (keyCode === KeyCodes.c) {
  //     handleCopy();
  //   } else if (keyCode === KeyCodes.v) {
  //     handlePaste();
  //   }
  // }

  function onPressTab(e: React.KeyboardEvent<HTMLDivElement>): void {
    // When there are no rows in the grid, we need to allow the browser to handle tab presses
    if (rows.length === 0) {
      return;
    }

    // If we are in a position to leave the grid, stop editing but stay in that cell
    if (canExitGrid(e, { cellNavigationMode, columns, rowsCount: rows.length, selectedPosition })) {
      if (isEditorEnabled) {
        closeEditor();
        return;
      }

      // Reset the selected position before exiting
      setSelectedPosition({ idx: -1, rowIdx: -1 });
      return;
    }

    e.preventDefault();
    const tabCellNavigationMode = cellNavigationMode === CellNavigationMode.NONE
      ? CellNavigationMode.CHANGE_ROW
      : cellNavigationMode;
    const keyCode = e.shiftKey ? KeyCodes.ArrowLeft : KeyCodes.ArrowRight;
    let nextPosition = getNextPosition(keyCode);
    nextPosition = getNextSelectedCellPosition<R>({
      columns,
      rowsCount: rows.length,
      cellNavigationMode: tabCellNavigationMode,
      nextPosition
    });
    selectCell(nextPosition);
  }

  // function handleCopy(): void {
  //   const { idx, rowIdx } = selectedPosition;
  //   const value = rows[rowIdx][columns[idx].key];
  //   setCopiedPosition({ idx, rowIdx, value });
  // }

  // function handlePaste(): void {
  //   if (copiedPosition === null || !isCellEditable(selectedPosition)) {
  //     return;
  //   }

  //   const { rowIdx: toRow } = selectedPosition;

  //   const cellKey = columns[selectedPosition.idx].key;
  //   const { rowIdx: fromRow, idx, value } = copiedPosition;
  //   const fromCellKey = columns[idx].key;

  //   onRowsUpdate({
  //     cellKey,
  //     fromRow,
  //     toRow,
  //     updated: { [cellKey]: value } as never,
  //     action: UpdateActions.COPY_PASTE,
  //     fromCellKey
  //   });
  // }

  function changeCellFromEvent(e: React.KeyboardEvent<HTMLDivElement>): void {
    e.preventDefault();
    let nextPosition = getNextPosition(e.keyCode);
    nextPosition = getNextSelectedCellPosition<R>({
      columns,
      rowsCount: rows.length,
      cellNavigationMode,
      nextPosition
    });

    selectCell(nextPosition);
  }

  function isCellWithinBounds({ idx, rowIdx }: Position): boolean {
    return rowIdx >= 0 && rowIdx < rows.length && idx >= 0 && idx < columns.length;
  }

  function isCellEditable(position: Position) {
    return isCellWithinBounds(position)
      && isSelectedCellEditable<R>({ columns, rows, selectedPosition: position, onCheckCellIsEditable });
  }

  function selectCell(position: Position, enableEditor = false): void {
    // Close the editor to commit any pending changes
    if (isEditorEnabled) {
      closeEditor();
    }

    if (!isCellWithinBounds(position)) return;

    scrollToCell(position);
    setSelectedPosition(position);
    onSelectedCellChange?.({ ...position });
    if (enableEditor && isCellEditable(position)) {
      // The editor position is dependent on the selectionMask position so we need to wait
      // for the next render cycle when the updated selection mask position is set
      setIsEditorEnabled(true);
    }
  }

  function isDragEnabled(): boolean {
    return enableCellDragAndDrop && isCellEditable(selectedPosition);
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>): void {
    e.dataTransfer.effectAllowed = 'copy';
    // Setting data is required to make an element draggable in FF
    const transferData = JSON.stringify(selectedPosition);
    try {
      e.dataTransfer.setData('text/plain', transferData);
    } catch (ex) {
      // IE only supports 'text' and 'URL' for the 'type' argument
      e.dataTransfer.setData('text', transferData);
    }
    setDraggedPosition({ ...selectedPosition, overRowIdx: selectedPosition.rowIdx });
  }

  function handleDragEnd() {
    if (draggedPosition === null) return;

    const { rowIdx, overRowIdx } = draggedPosition;
    const column = columns[draggedPosition.idx];
    const cellKey = column.key;
    const value = rows[rowIdx][cellKey];

    onRowsUpdate({
      cellKey,
      fromRow: rowIdx,
      toRow: overRowIdx,
      updated: { [cellKey]: value } as never,
      action: UpdateActions.CELL_DRAG
    });

    setDraggedPosition(null);
  }

  function onDragHandleDoubleClick(): void {
    const column = columns[selectedPosition.idx];
    const cellKey = column.key;
    const value = rows[selectedPosition.rowIdx][cellKey];

    onRowsUpdate({
      cellKey,
      fromRow: selectedPosition.rowIdx,
      toRow: rows.length - 1,
      updated: { [cellKey]: value } as never,
      action: UpdateActions.COLUMN_FILL
    });
  }

  // function onCommit({ cellKey, rowIdx, updated }: CommitEvent<R>): void {
  //   onRowsUpdate({
  //     cellKey,
  //     fromRow: rowIdx,
  //     toRow: rowIdx,
  //     updated,
  //     action: UpdateActions.CELL_UPDATE
  //   });
  //   closeEditor();
  // }

  function getSelectedDimensions(selectedPosition: Position): Dimension {
    const top = rowHeight * selectedPosition.rowIdx;
    const dimension = getDimensions({ selectedPosition, columns, scrollLeft, rowHeight });
    dimension.top = top;
    return dimension;
  }

  return (
    <div
      onKeyDown={onKeyDown}
    >
      {copiedPosition && isCellWithinBounds(copiedPosition) && (
        <CellMask
          className="rdg-cell-copied"
          {...getSelectedDimensions(copiedPosition)}
        />
      )}
      {draggedPosition && isCellWithinBounds(draggedPosition) && (
        <DragMask
          draggedPosition={draggedPosition}
          getSelectedDimensions={getSelectedDimensions}
        />
      )}
      {!isEditorEnabled && isCellWithinBounds(selectedPosition) && (
        <CellMask
          className="rdg-selected"
          tabIndex={0}
          ref={selectionMaskRef}
          {...getSelectedDimensions(selectedPosition)}
        >
          {isDragEnabled() && (
            <div
              className="drag-handle"
              draggable
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDoubleClick={onDragHandleDoubleClick}
            />
          )}
        </CellMask>
      )}
      {isEditorEnabled && isCellWithinBounds(selectedPosition) && (
        <EditorContainer
          column={columns[selectedPosition.idx]}
          row={rows[selectedPosition.rowIdx]}
          canvasRef={canvasRef}
          editorPortalTarget={editorPortalTarget}
          rowIdx={selectedPosition.rowIdx}
          rowHeight={rowHeight}
          scrollTop={scrollTop}
          scrollLeft={scrollLeft}
          onRowsUpdate={onRowsUpdate}
          onClose={closeEditor}
        />
      )}
      {/* {isEditorEnabled && isCellWithinBounds(selectedPosition) && (
        <EditorPortal target={editorPortalTarget}>
          <EditorContainer<R, K>
            firstEditorKeyPress={firstEditorKeyPress}
            onCommit={onCommit}
            onCommitCancel={closeEditor}
            rowIdx={selectedPosition.rowIdx}
            row={rows[selectedPosition.rowIdx]}
            column={columns[selectedPosition.idx]}
            scrollLeft={scrollLeft}
            scrollTop={scrollTop}
            {...getSelectedDimensions(selectedPosition)}
            {...getEditorPosition()}
          />
        </EditorPortal>
      )} */}
    </div>
  );
}