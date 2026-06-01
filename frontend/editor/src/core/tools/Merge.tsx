import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Stack, Text } from "@mantine/core";
import { createToolFlow } from "@app/components/tools/shared/createToolFlow";
import MergeSettings from "@app/components/tools/merge/MergeSettings";
import MergeFileSorter from "@app/components/tools/merge/MergeFileSorter";
import MergeFileList from "@app/components/tools/merge/MergeFileList";
import { useMergeParameters } from "@app/hooks/tools/merge/useMergeParameters";
import { useMergeOperation } from "@app/hooks/tools/merge/useMergeOperation";
import { useBaseTool } from "@app/hooks/tools/shared/useBaseTool";
import { BaseToolProps, ToolComponent } from "@app/types/tool";
import { FileId } from "@app/types/fileContext";
import { useMergeTips } from "@app/components/tooltips/useMergeTips";
import { useFileManagement, useAllFiles } from "@app/contexts/FileContext";
import {
  useNavigationState,
  useNavigationActions,
} from "@app/contexts/NavigationContext";

const Merge = (props: BaseToolProps) => {
  const { t } = useTranslation();
  const mergeTips = useMergeTips();

  // File hooks. The merge operates on ALL active files (useViewScopedFiles with ignoreViewerScope),
  // so the in-panel list mirrors `fileStubs` directly — the exact set, and order, that is merged.
  const { fileStubs } = useAllFiles();
  const { reorderFiles, removeFiles } = useFileManagement();

  const mergeItems = fileStubs.map((stub) => ({
    id: stub.id,
    name: stub.name,
    pageCount: stub.processedFile?.totalPages,
    thumbnailUrl: stub.thumbnailUrl,
  }));
  const totalMergePages = mergeItems.reduce(
    (sum, item) => sum + (item.pageCount ?? 0),
    0,
  );

  // Reorder the merge = reorder the active files (the full set is the merge order).
  const handleReorderMerge = useCallback(
    (orderedIds: string[]) => {
      reorderFiles(orderedIds as FileId[]);
    },
    [reorderFiles],
  );

  // Remove from the merge = drop the file from the active set (kept in the file library,
  // not deleted from storage), so it no longer participates in the merge.
  const handleRemoveFromMerge = useCallback(
    (id: string) => {
      removeFiles([id as FileId], false);
    },
    [removeFiles],
  );

  const base = useBaseTool(
    "merge",
    useMergeParameters,
    useMergeOperation,
    props,
    { minFiles: 2, ignoreViewerScope: true },
  );

  const { workbench } = useNavigationState();
  const { actions: navActions } = useNavigationActions();
  const isViewerMode = workbench === "viewer";

  const hasAutoSwitchedRef = useRef(false);
  useEffect(() => {
    if (isViewerMode && !hasAutoSwitchedRef.current) {
      hasAutoSwitchedRef.current = true;
      navActions.setWorkbench("fileEditor");
    }
  }, []);
  const naturalCompare = useCallback((a: string, b: string): number => {
    const isDigit = (char: string) => char >= "0" && char <= "9";

    const getChunk = (
      s: string,
      length: number,
      marker: number,
    ): { chunk: string; newMarker: number } => {
      let chunk = "";
      const c = s.charAt(marker);
      chunk += c;
      marker++;

      if (isDigit(c)) {
        while (marker < length && isDigit(s.charAt(marker))) {
          chunk += s.charAt(marker);
          marker++;
        }
      } else {
        while (marker < length && !isDigit(s.charAt(marker))) {
          chunk += s.charAt(marker);
          marker++;
        }
      }
      return { chunk, newMarker: marker };
    };

    const len1 = a.length;
    const len2 = b.length;
    let marker1 = 0;
    let marker2 = 0;

    while (marker1 < len1 && marker2 < len2) {
      const { chunk: chunk1, newMarker: newMarker1 } = getChunk(
        a,
        len1,
        marker1,
      );
      marker1 = newMarker1;

      const { chunk: chunk2, newMarker: newMarker2 } = getChunk(
        b,
        len2,
        marker2,
      );
      marker2 = newMarker2;

      let result: number;
      if (isDigit(chunk1.charAt(0)) && isDigit(chunk2.charAt(0))) {
        const num1 = parseInt(chunk1, 10);
        const num2 = parseInt(chunk2, 10);
        result = num1 - num2;
      } else {
        result = chunk1.localeCompare(chunk2);
      }

      if (result !== 0) {
        return result;
      }
    }

    return len1 - len2;
  }, []);

  // Custom file sorting logic for merge tool
  const sortFiles = useCallback(
    (sortType: "filename" | "dateModified", ascending: boolean = true) => {
      const sortedStubs = [...fileStubs].sort((stubA, stubB) => {
        let comparison = 0;
        switch (sortType) {
          case "filename":
            comparison = naturalCompare(stubA.name, stubB.name);
            break;
          case "dateModified":
            comparison = stubA.lastModified - stubB.lastModified;
            break;
        }
        return ascending ? comparison : -comparison;
      });

      reorderFiles(sortedStubs.map((record) => record.id));
    },
    [fileStubs, reorderFiles, naturalCompare],
  );

  return createToolFlow({
    files: {
      selectedFiles: base.selectedFiles,
      isCollapsed: base.hasResults,
      minFiles: 2,
    },
    steps: [
      {
        title: t("merge.orderStep.title", "Files to merge"),
        isCollapsed: base.settingsCollapsed,
        content: (
          <Stack gap="sm">
            <MergeFileList
              items={mergeItems}
              onReorder={handleReorderMerge}
              onRemove={handleRemoveFromMerge}
              disabled={base.endpointLoading}
            />
            <MergeFileSorter
              onSortFiles={sortFiles}
              disabled={!base.hasFiles || base.endpointLoading}
              showDescription={false}
            />
          </Stack>
        ),
      },
      {
        title: "Settings",
        isCollapsed: base.settingsCollapsed,
        onCollapsedClick: base.settingsCollapsed
          ? base.handleSettingsReset
          : undefined,
        tooltip: mergeTips,
        content: (
          <MergeSettings
            parameters={base.params.parameters}
            onParameterChange={base.params.updateParameter}
            disabled={base.endpointLoading}
          />
        ),
      },
    ],
    executeButton: {
      text:
        totalMergePages > 0
          ? t("merge.submitWithPages", "Merge → {{count}} pages", {
              count: totalMergePages,
            })
          : t("merge.submit", "Merge PDFs"),
      isVisible: !base.hasResults,
      loadingText: t("loading"),
      onClick: base.handleExecute,
      endpointEnabled: base.endpointEnabled,
      paramsValid: base.params.validateParameters(),
      disabledReason: isViewerMode ? "viewerMode" : undefined,
    },
    belowExecuteButton:
      isViewerMode && !base.hasResults ? (
        <Stack align="center" gap={6} mx="md" mt={4}>
          <Text size="xs" c="dimmed" ta="center">
            {t(
              "merge.viewerModeHint",
              "Merge needs 2 or more files. Head to the file editor to select them.",
            )}
          </Text>
          <Button
            variant="light"
            size="xs"
            onClick={() => navActions.setWorkbench("fileEditor")}
          >
            {t("merge.goToFileEditor", "Go to file editor")}
          </Button>
        </Stack>
      ) : undefined,
    review: {
      isVisible: base.hasResults,
      operation: base.operation,
      title: t("merge.title", "Merge Results"),
      onFileClick: base.handleThumbnailClick,
      onUndo: base.handleUndo,
    },
  });
};

export default Merge as ToolComponent;
