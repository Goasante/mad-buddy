"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  useId,
  useMemo,
  useRef,
  useState,
  Fragment,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { useDismissOnBack } from "@/hooks/use-dismiss-on-back";
import { cn } from "@/lib/utils";

export type AppSelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  keywords?: string[];
  disabled?: boolean;
};

type SelectSize = "form" | "compact";

export type AppSelectProps<T extends string = string> = {
  id?: string;
  label?: string;
  value: T | null;
  options: AppSelectOption<T>[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  size?: SelectSize;
  className?: string;
  triggerClassName?: string;
  onChange: (value: T) => void;
};

const EMPTY_VALUE = "__mad_buddy_empty_value__";

function encodeValue(value: string | null) {
  return value === "" ? EMPTY_VALUE : value ?? "";
}

function decodeValue(value: string) {
  return value === EMPTY_VALUE ? "" : value;
}

function fieldIds(id: string, helperText?: string, error?: string) {
  return {
    helperId: helperText ? `${id}-helper` : undefined,
    errorId: error ? `${id}-error` : undefined,
    describedBy: [helperText ? `${id}-helper` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined
  };
}

function FieldFrame({
  id,
  label,
  required,
  helperText,
  error,
  className,
  children
}: {
  id: string;
  label?: string;
  required?: boolean;
  helperText?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  const ids = fieldIds(id, helperText, error);
  return (
    <div className={cn("min-w-0 max-w-full space-y-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="block text-sm font-medium text-foreground">
          {label}{required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {helperText && !error ? <p id={ids.helperId} className="text-xs leading-5 text-muted-foreground">{helperText}</p> : null}
      {error ? <p id={ids.errorId} className="text-xs font-medium leading-5 text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

function TriggerContents<T extends string>({
  option,
  placeholder,
  open
}: {
  option?: AppSelectOption<T>;
  placeholder: string;
  open: boolean;
}) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {option?.icon ? <span className="shrink-0 text-muted-foreground" aria-hidden="true">{option.icon}</span> : null}
        <span className={cn("min-w-0 truncate", !option && "text-muted-foreground")}>{option?.label ?? placeholder}</span>
      </span>
      <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
    </>
  );
}

export function AppSelect<T extends string = string>(props: AppSelectProps<T>) {
  if (props.searchable) return <AppCombobox {...props} />;
  return <StandardAppSelect {...props} />;
}

function StandardAppSelect<T extends string = string>({
  id: providedId,
  label,
  value,
  options,
  placeholder = "Choose an option",
  error,
  helperText,
  disabled,
  required,
  size = "form",
  className,
  triggerClassName,
  onChange
}: AppSelectProps<T>) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const ids = fieldIds(id, helperText, error);
  useDismissOnBack(open, () => setOpen(false));

  return (
    <FieldFrame id={id} label={label} required={required} helperText={helperText} error={error} className={className}>
      <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            className={cn("app-select-trigger min-w-0 max-w-full", size === "compact" && "app-select-trigger-compact", error && "app-select-trigger-error", triggerClassName)}
            aria-describedby={ids.describedBy}
          >
            <TriggerContents option={selected} placeholder={placeholder} open={open} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={7}
            collisionPadding={12}
            align="start"
            className="app-dropdown-content"
            style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)", maxWidth: "min(28rem, calc(100vw - 1.5rem))" }}
          >
            <DropdownMenu.RadioGroup value={encodeValue(value)} onValueChange={(next) => onChange(decodeValue(next) as T)}>
              {options.map((option) => (
                <DropdownMenu.RadioItem
                  key={encodeValue(option.value)}
                  value={encodeValue(option.value)}
                  disabled={option.disabled}
                  className={cn("app-dropdown-option", option.description && "app-dropdown-option-described")}
                >
                  {option.icon ? <span className="shrink-0 text-muted-foreground" aria-hidden="true">{option.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{option.label}</span>
                    {option.description ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{option.description}</span> : null}
                  </span>
                  <span className="grid h-5 w-5 shrink-0 place-items-center text-[var(--color-brand-orange)]">
                    <DropdownMenu.ItemIndicator><Check className="h-4 w-4" aria-hidden="true" /></DropdownMenu.ItemIndicator>
                  </span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </FieldFrame>
  );
}

export function AppCombobox<T extends string = string>({
  id: providedId,
  label,
  value,
  options,
  placeholder = "Choose an option",
  searchPlaceholder = "Search options...",
  emptyText = "No options found",
  error,
  helperText,
  disabled,
  required,
  size = "form",
  className,
  triggerClassName,
  onChange
}: AppSelectProps<T>) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const listboxId = `${id}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const ids = fieldIds(id, helperText, error);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) =>
      [option.label, option.description, ...(option.keywords ?? [])]
        .filter(Boolean)
        .some((part) => part!.toLowerCase().includes(term))
    );
  }, [options, query]);
  const enabledIndexes = filtered.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
  useDismissOnBack(open, () => setOpen(false));

  function choose(option: AppSelectOption<T>) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  function moveActive(direction: 1 | -1) {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(activeIndex);
    const nextPosition = position < 0 ? 0 : (position + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); moveActive(1); }
    if (event.key === "ArrowUp") { event.preventDefault(); moveActive(-1); }
    if (event.key === "Home") { event.preventDefault(); setActiveIndex(enabledIndexes[0] ?? 0); }
    if (event.key === "End") { event.preventDefault(); setActiveIndex(enabledIndexes.at(-1) ?? 0); }
    if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <FieldFrame id={id} label={label} required={required} helperText={helperText} error={error} className={className}>
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setQuery("");
            const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
          }
        }}
      >
        <Popover.Trigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            className={cn("app-select-trigger min-w-0 max-w-full", size === "compact" && "app-select-trigger-compact", error && "app-select-trigger-error", triggerClassName)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-describedby={ids.describedBy}
          >
            <TriggerContents option={selected} placeholder={placeholder} open={open} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={7}
            collisionPadding={12}
            align="start"
            className="app-dropdown-content p-2"
            style={{ width: "var(--radix-popover-trigger-width)", maxWidth: "min(28rem, calc(100vw - 1.5rem))" }}
            onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
          >
            <div className="relative border-b border-border/60 pb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-[calc(50%+4px)] text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                className="focus-ring h-10 w-full rounded-lg bg-transparent pl-9 pr-9 text-sm outline-none placeholder:text-muted-foreground"
                role="combobox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-activedescendant={filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
              />
              {query ? (
                <button
                  type="button"
                  className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-[calc(50%+4px)] place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div id={listboxId} role="listbox" className="max-h-72 overflow-y-auto pt-2">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
              ) : (
                filtered.map((option, index) => (
                  <button
                    key={encodeValue(option.value)}
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option)}
                    className={cn(
                      "app-dropdown-option w-full",
                      option.description && "app-dropdown-option-described",
                      index === activeIndex && "app-dropdown-option-active"
                    )}
                  >
                    {option.icon ? <span className="shrink-0 text-muted-foreground" aria-hidden="true">{option.icon}</span> : null}
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">{option.label}</span>
                      {option.description ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{option.description}</span> : null}
                    </span>
                    {option.value === value ? <Check className="h-4 w-4 shrink-0 text-[var(--color-brand-orange)]" aria-hidden="true" /> : null}
                  </button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </FieldFrame>
  );
}

export type AppMenuItem = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
};

export type AppMenuProps = {
  label: string;
  trigger: ReactNode;
  items: AppMenuItem[];
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
};

export function AppMenu({ label, trigger, items, align = "end", side = "bottom" }: AppMenuProps) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="app-dropdown-content min-w-52"
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separatorBefore ? <DropdownMenu.Separator className="my-1 h-px bg-border/70" /> : null}
              <DropdownMenu.Item
                disabled={item.disabled}
                onSelect={(event) => {
                  event.preventDefault();
                  item.onSelect();
                }}
                className={cn("app-dropdown-option cursor-pointer", item.destructive && "text-destructive focus:text-destructive")}
              >
                {item.icon ? <span className="shrink-0" aria-hidden="true">{item.icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.label}</span>
                  {item.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span> : null}
                </span>
              </DropdownMenu.Item>
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
