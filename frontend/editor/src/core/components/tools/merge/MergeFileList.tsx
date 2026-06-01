import React, { useRef, useState } from "react";
import { Stack, Group, Text, ActionIcon, Paper, Box } from "@mantine/core";
import { useTranslation } from "react-i18next";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";

export interface MergeFileItem {
  id: string;
  name: string;
  pageCount?: number;
  thumbnailUrl?: string;
}

interface MergeFileListProps {
  items: MergeFileItem[];
  /** Called with the new full order of item ids (drag or move up/down). */
  onReorder: (orderedIds: string[]) => void;
  /** Called to remove a file from the merge (deselect). */
  onRemove: (id: string) => void;
  disabled?: boolean;
}

/** Pure helper: move the item at `from` to `to`, returning a new array. */
export function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) {
    return arr.slice();
  }
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

const MergeFileList: React.FC<MergeFileListProps> = ({
  items,
  onReorder,
  onRemove,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (disabled) return;
    onReorder(moveInArray(items, from, to).map((it) => it.id));
  };

  const handleDrop = (to: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === to) return;
    move(from, to);
  };

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        {t(
          "merge.fileList.description",
          "Files merge top to bottom. Drag, or use the arrows, to reorder.",
        )}
      </Text>

      <Stack gap={6}>
        {items.map((item, index) => {
          const isOver = overIndex === index;
          return (
            <Paper
              key={item.id}
              withBorder
              p={6}
              radius="sm"
              data-testid={`merge-file-row-${item.id}`}
              draggable={!disabled}
              onDragStart={() => {
                dragIndex.current = index;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (overIndex !== index) setOverIndex(index);
              }}
              onDragLeave={() => {
                if (overIndex === index) setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(index);
              }}
              style={{
                cursor: disabled ? "default" : "grab",
                outline: isOver ? "2px solid var(--mantine-color-blue-5)" : "none",
                outlineOffset: -1,
              }}
            >
              <Group gap={8} wrap="nowrap" align="center">
                <Box c="dimmed" style={{ display: "flex", flexShrink: 0 }}>
                  <DragIndicatorIcon fontSize="small" />
                </Box>
                <Text size="xs" c="dimmed" fw={600} w={14} ta="center" style={{ flexShrink: 0 }}>
                  {index + 1}
                </Text>

                {/* Thumbnail */}
                <Box
                  style={{
                    width: 30,
                    height: 40,
                    flexShrink: 0,
                    borderRadius: 3,
                    overflow: "hidden",
                    background: "var(--mantine-color-gray-1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <InsertDriveFileOutlinedIcon fontSize="small" color="disabled" />
                  )}
                </Box>

                {/* Name + page count */}
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate title={item.name}>
                    {item.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {item.pageCount == null
                      ? t("merge.fileList.pagesUnknown", "PDF")
                      : item.pageCount === 1
                        ? t("merge.fileList.page", "1 page")
                        : t("merge.fileList.pages", "{{count}} pages", {
                            count: item.pageCount,
                          })}
                  </Text>
                </Stack>

                {/* Controls */}
                <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, index - 1)}
                    title={t("merge.fileList.moveUp", "Move up")}
                    aria-label={t("merge.fileList.moveUp", "Move up")}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    disabled={disabled || index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                    title={t("merge.fileList.moveDown", "Move down")}
                    aria-label={t("merge.fileList.moveDown", "Move down")}
                  >
                    <ArrowDownwardIcon fontSize="small" />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onRemove(item.id)}
                    title={t("merge.fileList.remove", "Remove from merge")}
                    aria-label={t("merge.fileList.remove", "Remove from merge")}
                    data-testid={`merge-file-remove-${item.id}`}
                  >
                    <CloseIcon fontSize="small" />
                  </ActionIcon>
                </Group>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
};

export default MergeFileList;
