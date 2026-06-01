import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import MergeFileList, { moveInArray, type MergeFileItem } from "./MergeFileList";

// i18n: components call t(key, fallback) — mock returns the fallback (interpolating {{count}}).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(`{{${k}}}`, String(v));
        }
      }
      return out;
    },
  }),
}));

describe("moveInArray", () => {
  it("moves an item up", () => {
    expect(moveInArray(["a", "b", "c"], 1, 0)).toEqual(["b", "a", "c"]);
  });
  it("moves an item down", () => {
    expect(moveInArray(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
  it("is a no-op for from===to or out-of-range", () => {
    expect(moveInArray(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveInArray(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveInArray(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
  it("returns a new array (no mutation)", () => {
    const orig = ["a", "b", "c"];
    const out = moveInArray(orig, 0, 2);
    expect(orig).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(orig);
  });
});

const items: MergeFileItem[] = [
  { id: "f1", name: "first.pdf", pageCount: 4 },
  { id: "f2", name: "second.pdf", pageCount: 7 },
];

function renderList(props: Partial<React.ComponentProps<typeof MergeFileList>> = {}) {
  const onReorder = vi.fn();
  const onRemove = vi.fn();
  render(
    <MantineProvider>
      <MergeFileList items={items} onReorder={onReorder} onRemove={onRemove} {...props} />
    </MantineProvider>,
  );
  return { onReorder, onRemove };
}

describe("MergeFileList", () => {
  it("renders a row per file with name and page count", () => {
    renderList();
    expect(screen.getByText("first.pdf")).toBeInTheDocument();
    expect(screen.getByText("second.pdf")).toBeInTheDocument();
    expect(screen.getByText("4 pages")).toBeInTheDocument();
    expect(screen.getByText("7 pages")).toBeInTheDocument();
  });

  it("move-down on the first row reorders ids", () => {
    const { onReorder } = renderList();
    const downButtons = screen.getAllByLabelText("Move down");
    fireEvent.click(downButtons[0]); // move f1 down
    expect(onReorder).toHaveBeenCalledWith(["f2", "f1"]);
  });

  it("disables move-up on the first row and move-down on the last", () => {
    renderList();
    const ups = screen.getAllByLabelText("Move up");
    const downs = screen.getAllByLabelText("Move down");
    expect(ups[0]).toBeDisabled(); // first row can't go up
    expect(downs[downs.length - 1]).toBeDisabled(); // last row can't go down
  });

  it("remove calls onRemove with the file id", () => {
    const { onRemove } = renderList();
    fireEvent.click(screen.getByTestId("merge-file-remove-f1"));
    expect(onRemove).toHaveBeenCalledWith("f1");
  });
});
