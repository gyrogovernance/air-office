import { Children, isValidElement, useId, type ReactNode } from 'react';
import { Autocomplete, EmptyState, Header, ListBox, SearchField, Select, Separator, useFilter, type Key } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiChat02Icon, Calendar03Icon, ChevronDownIcon, Database01Icon, File01Icon, GridViewIcon, InformationCircleIcon, Settings01Icon, UserGroupIcon, Wrench01Icon } from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';

type Option = { value: string; label: ReactNode; disabled?: boolean; group?: string };
const optionIcons: Record<string, IconSvgElement> = { Apps: GridViewIcon, Workspace: File01Icon, Interface: Settings01Icon, Data: Database01Icon, About: InformationCircleIcon, Agents: UserGroupIcon, Prompts: AiChat02Icon, Skills: Wrench01Icon, Tools: Wrench01Icon, Schedules: Calendar03Icon };

function readOptions(children: ReactNode, group?: string): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? (typeof child.props.children === 'string' || typeof child.props.children === 'number' ? child.props.children : '')), label: child.props.children, disabled: child.props.disabled, group }];
    return readOptions(child.props.children, child.type === 'optgroup' ? child.props.label : group);
  });
}

function textOf(label: ReactNode): string {
  if (typeof label === 'string' || typeof label === 'number') return String(label);
  return '';
}

function optionTextValue(option: Option): string {
  const label = textOf(option.label);
  return label && label !== option.value ? `${label} ${option.value}` : label || option.value;
}

function optionLeading(option: Option, icons?: Record<string, IconSvgElement>, leadings?: Record<string, ReactNode>) {
  if (leadings && option.value in leadings) return <span className="app-select-leading" aria-hidden="true">{leadings[option.value]}</span>;
  const icon = icons?.[option.value] ?? (typeof option.label === 'string' ? optionIcons[option.label] : undefined);
  return icon ? <HugeiconsIcon icon={icon} size={16} aria-hidden="true"/> : null;
}

function renderOption(option: Option, groupIndex: number, icons?: Record<string, IconSvgElement>, leadings?: Record<string, ReactNode>) {
  return <ListBox.Item key={option.value || `empty-${groupIndex}`} id={option.value} textValue={optionTextValue(option)} isDisabled={option.disabled} className="app-select-option">
    {optionLeading(option, icons, leadings)}
    {option.label}
    <ListBox.ItemIndicator>{() => null}</ListBox.ItemIndicator>
  </ListBox.Item>;
}

function groupOptions(listed: Option[]): { name?: string; items: Option[] }[] {
  const groups: { name?: string; items: Option[] }[] = [];
  for (const option of listed) {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.items.push(option);
    else groups.push({ name: option.group, items: [option] });
  }
  return groups;
}

function renderGroupedOptions(groups: { name?: string; items: Option[] }[], icons?: Record<string, IconSvgElement>, leadings?: Record<string, ReactNode>) {
  return groups.map((group, groupIndex) => group.name === undefined
    ? group.items.map((option) => renderOption(option, groupIndex, icons, leadings))
    : <ListBox.Section key={group.name}>
      <Header className="app-select-group">{group.name}</Header>
      {group.items.map((option) => renderOption(option, groupIndex, icons, leadings))}
    </ListBox.Section>);
}

function renderFooterAction(footerAction: { value: string; label: ReactNode; icon?: IconSvgElement }) {
  return <>
    <Separator className="app-select-separator"/>
    <ListBox.Item id={footerAction.value} textValue={textOf(footerAction.label)} className="app-select-option app-select-footer-option">
      {footerAction.icon && <HugeiconsIcon icon={footerAction.icon} size={16} aria-hidden="true"/>}
      {footerAction.label}
      <ListBox.ItemIndicator>{() => null}</ListBox.ItemIndicator>
    </ListBox.Item>
  </>;
}

function TriggerContents({
  selectedLeading,
  selectedIcon,
  triggerLabel,
}: {
  selectedLeading?: ReactNode;
  selectedIcon?: IconSvgElement;
  triggerLabel?: string;
}) {
  return <>
    {selectedLeading}
    {!selectedLeading && selectedIcon && <HugeiconsIcon icon={selectedIcon} size={16} aria-hidden="true" className="app-select-icon"/>}
    {triggerLabel !== undefined
      ? <>
        {triggerLabel !== '' && <span className="app-select-text" aria-hidden="true">{triggerLabel}</span>}
        <span className="sr-only"><Select.Value/></span>
      </>
      : <Select.Value/>}
  </>;
}

/** Shared selection control; HeroUI owns keyboard navigation, typeahead and focus. */
export function SelectField({ children, value, onValueChange, icons, leadings, triggerLabel, placement = 'bottom', placeholder: placeholderProp, listEmptyOption = true, footerAction, searchable = false, ...props }: {
  children: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  /** An icon per option value. The icon appears beside the option and in the trigger. */
  icons?: Record<string, IconSvgElement>;
  /** A custom leading mark per option value (for example an avatar). Wins over icons. */
  leadings?: Record<string, ReactNode>;
  /**
   * A shorter text for the trigger. The list keeps the full labels, so a long
   * name does not have to fit in a small button.
   */
  triggerLabel?: string;
  placement?: 'top' | 'bottom';
  /** Trigger text when nothing is selected. Overrides an empty option's label. */
  placeholder?: string;
  /**
   * When false, an empty-value option is used only as the trigger placeholder
   * and is not offered as a selectable row in the list.
   */
  listEmptyOption?: boolean;
  /** A trailing action below a separator (for example Manage Models). */
  footerAction?: { value: string; label: ReactNode; icon?: IconSvgElement };
  /** Puts a search field above the options for long lists (model pickers). */
  searchable?: boolean;
  'aria-label'?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const id = useId();
  const { contains } = useFilter({ sensitivity: 'base' });
  const options = readOptions(children);
  const selected = options.find((option) => option.value === value);
  // An empty-value option ("All categories", "Select a model") doubles as the
  // trigger placeholder; listEmptyOption decides whether it stays selectable.
  const emptyOption = options.find((option) => option.value === '');
  const placeholder = placeholderProp ?? (emptyOption ? textOf(emptyOption.label) || undefined : undefined);
  const selectedLeading = leadings && value in leadings
    ? <span className="app-select-leading" aria-hidden="true">{leadings[value]}</span>
    : undefined;
  const selectedIcon = selectedLeading ? undefined : icons ? icons[value] ?? (typeof selected?.label === 'string' ? optionIcons[selected.label] : undefined) : typeof selected?.label === 'string' ? optionIcons[selected.label] : undefined;
  const listed = listEmptyOption ? options : options.filter((option) => option.value !== '');
  const groups = groupOptions(listed);
  const footerText = footerAction ? textOf(footerAction.label) : '';
  const filterOptions = (textValue: string, inputValue: string) => {
    if (footerText && textValue === footerText) return true;
    if (!inputValue.trim()) return true;
    return contains(textValue, inputValue);
  };
  const onChange = (next: Key | null) => { if (next !== null) onValueChange(String(next)); };
  const triggerId = props.id ?? id;
  const listLabel = props['aria-label'] ?? 'Options';
  const triggerBody = <TriggerContents selectedLeading={selectedLeading} selectedIcon={selectedIcon} triggerLabel={triggerLabel}/>;
  // Autocomplete uses Select.Value under the hood; for a custom short trigger
  // label the searchable path mirrors the same sr-only / visible split.
  const searchableTriggerBody = triggerLabel !== undefined
    ? <>
      {selectedLeading}
      {!selectedLeading && selectedIcon && <HugeiconsIcon icon={selectedIcon} size={16} aria-hidden="true" className="app-select-icon"/>}
      {triggerLabel !== '' && <span className="app-select-text" aria-hidden="true">{triggerLabel}</span>}
      <span className="sr-only"><Autocomplete.Value/></span>
    </>
    : <>
      {selectedLeading}
      {!selectedLeading && selectedIcon && <HugeiconsIcon icon={selectedIcon} size={16} aria-hidden="true" className="app-select-icon"/>}
      <Autocomplete.Value/>
    </>;

  if (searchable) {
    return <Autocomplete value={value || null} placeholder={placeholder} onChange={onChange} isDisabled={props.disabled} aria-label={props['aria-label']}>
      <Autocomplete.Trigger id={triggerId} className={props.className}>
        {searchableTriggerBody}
        <Autocomplete.Indicator><HugeiconsIcon icon={ChevronDownIcon} size={16} aria-hidden="true" className="app-select-chevron"/></Autocomplete.Indicator>
      </Autocomplete.Trigger>
      <Autocomplete.Popover className="app-select-popover" placement={placement}>
        <Autocomplete.Filter filter={filterOptions}>
          <SearchField autoFocus aria-label="Search options" variant="secondary" className="app-select-search">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <ListBox aria-label={listLabel} renderEmptyState={() => <EmptyState>No matches</EmptyState>}>
            {renderGroupedOptions(groups, icons, leadings)}
            {footerAction && renderFooterAction(footerAction)}
          </ListBox>
        </Autocomplete.Filter>
      </Autocomplete.Popover>
    </Autocomplete>;
  }

  return <Select value={value || null} placeholder={placeholder} onChange={onChange} isDisabled={props.disabled} aria-label={props['aria-label']}>
    <Select.Trigger id={triggerId} className={props.className}>
      {triggerBody}
      <Select.Indicator><HugeiconsIcon icon={ChevronDownIcon} size={16} aria-hidden="true" className="app-select-chevron"/></Select.Indicator>
    </Select.Trigger>
    <Select.Popover className="app-select-popover" placement={placement}>
      <ListBox aria-label={listLabel}>
        {renderGroupedOptions(groups, icons, leadings)}
        {footerAction && renderFooterAction(footerAction)}
      </ListBox>
    </Select.Popover>
  </Select>;
}
