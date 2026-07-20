import { ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

import { InputText } from './InputText';

export interface SelectMultiOption {
  value: string;
  label: string;
}

export interface SelectMultiProps {
  options: SelectMultiOption[];
  value: string[];
  onChange: (selectedValues: string[]) => void;
  placeholder?: string;
  className?: string;
  searchable?: boolean;
  showSelectedTags?: boolean;
}

export const SelectMulti: React.FC<SelectMultiProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select options',
  className = '',
  searchable = false,
  showSelectedTags = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const rafRef = useRef<number>(0);

  const updateDropdownPos = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  // Continuously track trigger position while open so the dropdown follows
  // pan / zoom / scroll on the React Flow canvas.
  useEffect(() => {
    if (!isOpen) return;
    const track = () => {
      updateDropdownPos();
      rafRef.current = requestAnimationFrame(track);
    };
    rafRef.current = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOpen, updateDropdownPos]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isOpen) {
        updateDropdownPos();
      }
      setIsOpen((prev) => !prev);
    },
    [isOpen, updateDropdownPos],
  );

  const toggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const removeOption = (optionValue: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onChange(value.filter((v) => v !== optionValue));
  };

  const getSelectedLabels = () => {
    return value
      .map((v) => options.find((opt) => opt.value === v)?.label)
      .filter(Boolean);
  };

  const filteredOptions = searchable
    ? options.filter((option) =>
        option.label.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : options;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <div
        className="w-full min-h-[40px] px-3 py-2 border border-neutral rounded-md bg-background text-foreground cursor-pointer flex items-start gap-2"
        onClick={handleToggle}
      >
        {/* Tags area — can grow and scroll; chevron stays outside this */}
        <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto react-flow__node-scrollable flex-1">
          {value.length === 0 ? (
            <span className="text-muted-foreground mt-0.5">{placeholder}</span>
          ) : showSelectedTags ? (
            getSelectedLabels().map((label, index) => (
              <span
                key={value[index]}
                className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-sm"
              >
                {label}
                <button
                  onClick={(e) => removeOption(value[index], e)}
                  className="hover:bg-primary/20 rounded-full p-0.5"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            ))
          ) : (
            <span className="text-foreground mt-0.5">
              {value.length} selected
            </span>
          )}
        </div>
        {/* Chevron anchored at top-right, outside the flex-wrap area */}
        <ChevronDownIcon
          className={`w-4 h-4 shrink-0 mt-1 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </div>

      {isOpen &&
        ReactDOM.createPortal(
          // `data-portal-dropdown` marks this body-level portal so click-outside
          // handlers (e.g. the CTE editor popover) treat clicks on the dropdown
          // or its backdrop as inside, not as an outside-click that dismisses.
          <div data-portal-dropdown="true">
            {/* Transparent backdrop rendered at body level — works regardless of React Flow canvas transforms */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
              onClick={() => setIsOpen(false)}
            />
            {/* Dropdown also at body level so position: fixed is relative to actual viewport */}
            {dropdownPos && (
              <div
                style={{
                  position: 'fixed',
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  width: dropdownPos.width,
                  zIndex: 9999,
                }}
                className="bg-background border border-neutral rounded-md shadow-lg max-h-60 overflow-y-auto react-flow__node-scrollable"
              >
                {searchable && (
                  <div className="p-2 border-b border-neutral">
                    <InputText
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      inputClassName="!mt-0"
                    />
                  </div>
                )}
                <div
                  className={
                    searchable
                      ? 'max-h-48 overflow-y-auto react-flow__node-scrollable'
                      : ''
                  }
                >
                  {filteredOptions.length === 0 ? (
                    <div className="px-3 py-2 text-muted-foreground text-center">
                      {searchQuery
                        ? 'No options found'
                        : 'No options available'}
                    </div>
                  ) : (
                    filteredOptions.map((option) => (
                      <div
                        key={option.value}
                        className={`px-3 py-2 cursor-pointer hover:bg-surface/50 flex items-center gap-2 ${
                          value.includes(option.value) ? 'bg-surface/30' : ''
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOption(option.value);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={value.includes(option.value)}
                          onChange={() => {}}
                          className="w-4 h-4 rounded border-gray-300"
                        />
                        <span className="text-foreground">{option.label}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};
