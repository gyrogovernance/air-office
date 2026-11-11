import { parseDate } from '@internationalized/date';
import { Calendar, DateField as HeroDateField, DatePicker, Label } from '@heroui/react';
import { IconChevronLeft, IconChevronRight } from '../app/ui-icons.component';

export function DateField({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <DatePicker className="office-date-picker" value={value ? parseDate(value) : null} onChange={(date) => onChange(date?.toString() ?? '')} isDisabled={disabled} isRequired>
    <Label>{label}</Label>
    <HeroDateField.Group className="office-date-input" fullWidth>
      <HeroDateField.Input>{(segment) => <HeroDateField.Segment segment={segment}/>}</HeroDateField.Input>
      <HeroDateField.Suffix>
        <DatePicker.Trigger aria-label={`Choose ${label.toLowerCase()}`}>
          <DatePicker.TriggerIndicator>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 5h16v16H4zM4 10h16M8 3v4m8-4v4"/></svg>
          </DatePicker.TriggerIndicator>
        </DatePicker.Trigger>
      </HeroDateField.Suffix>
    </HeroDateField.Group>
    <DatePicker.Popover className="office-date-popover" placement="bottom start">
      <Calendar aria-label={`Choose ${label.toLowerCase()}`} firstDayOfWeek="mon">
        <Calendar.Header>
          <Calendar.NavButton slot="previous" aria-label="Previous month"><IconChevronLeft/></Calendar.NavButton>
          <Calendar.Heading/>
          <Calendar.NavButton slot="next" aria-label="Next month"><IconChevronRight/></Calendar.NavButton>
        </Calendar.Header>
        <Calendar.Grid>
          <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
          <Calendar.GridBody>{(date) => <Calendar.Cell date={date}/>}</Calendar.GridBody>
        </Calendar.Grid>
      </Calendar>
    </DatePicker.Popover>
  </DatePicker>;
}
