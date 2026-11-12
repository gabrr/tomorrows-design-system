import { useId, type ComponentProps, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Table } from "@astryxdesign/core/Table";
import { Banner } from "@astryxdesign/core/Banner";
export { Button, IconButton };
export { TextInput as Input } from "@astryxdesign/core/TextInput";
export { NumberInput as Numeric } from "@astryxdesign/core/NumberInput";
export { Selector as Select } from "@astryxdesign/core/Selector";
export { TextArea as Area } from "@astryxdesign/core/TextArea";
export { Text } from "@astryxdesign/core/Text";
export { Card } from "@astryxdesign/core/Card";
export { Badge } from "@astryxdesign/core/Badge";
export { Switch } from "@astryxdesign/core/Switch";
export { Slider } from "@astryxdesign/core/Slider";
export { TabList, Tab } from "@astryxdesign/core/TabList";
export { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
export { Tooltip } from "@astryxdesign/core/Tooltip";
export { Theme } from "@astryxdesign/core/theme";
export { FileInput } from "@astryxdesign/core/FileInput";
export { ChatComposer } from "@astryxdesign/core/Chat";
export { ToggleButton } from "@astryxdesign/core/ToggleButton";
type ActionProps = Omit<
  ComponentProps<typeof Button>,
  "isDisabled" | "isLoading" | "clickAction"
> & { disabled?: boolean; busy?: boolean; action?: () => Promise<void> };
export function Action({ disabled, busy, action, ...props }: ActionProps) {
  const host = useId();
  return (
    <Button
      data-ui-host={host}
      {...props}
      isDisabled={disabled}
      isLoading={busy}
      clickAction={action}
    />
  );
}
export function IconAction({
  disabled,
  busy,
  action,
  selected,
  ...props
}: ActionProps & { icon: ReactNode; selected?: boolean }) {
  const host = useId();
  if (selected !== undefined) {
    const { variant, value, ...toggleProps } = props;
    return (
      <ToggleButton
        {...toggleProps}
        value={typeof value === "string" ? value : undefined}
        data-ui-host={host}
        isIconOnly
        isPressed={selected}
        isDisabled={disabled}
        isLoading={busy}
        pressedChangeAction={action ? () => action() : undefined}
        tooltip={props.tooltip ?? props.label}
      />
    );
  }
  return (
    <IconButton
      data-ui-host={host}
      {...props}
      icon={props.icon}
      isDisabled={disabled}
      isLoading={busy}
      clickAction={action}
      aria-pressed={selected}
      tooltip={props.tooltip ?? props.label}
    />
  );
}
export function ModalShell({
  title,
  open,
  onClose,
  children,
  width = 760,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
}) {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      purpose="form"
      width={width}
    >
      <DialogHeader
        title={title}
        onOpenChange={(v) => {
          if (!v) onClose();
        }}
      />
      <div className="dialog-content stack">{children}</div>
    </Dialog>
  );
}
export function Disclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Collapsible
      className="app-disclosure"
      trigger={title}
      defaultIsOpen={false}
    >
      <div className="stack disclosure-content">{children}</div>
    </Collapsible>
  );
}
export function Message({
  text,
  error = false,
}: {
  text: string;
  error?: boolean;
}) {
  return (
    <Banner
      role={error ? "alert" : "status"}
      status={error ? "error" : "info"}
      title={text}
    />
  );
}
export function DataGrid({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  const data = rows.map((cells, i) => ({ id: String(i), cells }));
  return (
    <div className="data-grid">
      <Table
        aria-label={label}
        data={data}
        idKey="id"
        columns={columns.map((header, i) => ({
          key: "c" + i,
          header,
          renderCell: (row: { id: string; cells: ReactNode[] }) => row.cells[i],
        }))}
        density="compact"
        dividers="rows"
        textOverflow="wrap"
        hasHover
      />
    </div>
  );
}

export { ClickableCard } from "@astryxdesign/core/ClickableCard";
