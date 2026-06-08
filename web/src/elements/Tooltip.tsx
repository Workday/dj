import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { InformationCircleIcon as OutlineInformationCircleIcon } from '@heroicons/react/24/outline';
import { InformationCircleIcon as SolidInformationCircleIcon } from '@heroicons/react/24/solid';
import { type ElementType, type FC, type ReactNode, useRef } from 'react';

export type TooltipProps = {
  children?: ReactNode;
  content: ReactNode;
  align?: 'center' | 'start';
  iconSize?: number;
  iconColor?: string;
  variant?: 'solid' | 'outline';
  placement?: 'bottom' | 'right';
  // Override what HTML element wraps the trigger. Use 'div'/'span' when
  // children already contain an interactive element (e.g. a <button>) to
  // avoid nested-interactive a11y issues.
  as?: ElementType;
};

export const Tooltip: FC<TooltipProps> = ({
  children,
  content,
  align = 'start',
  variant = 'outline',
  placement = 'bottom',
  as,
}) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const openTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ref for the PopoverButton to programmatically control it
  const buttonRef = useRef<HTMLButtonElement>(null);

  const onMouseEnter = (open: boolean) => {
    // Clear any existing timeouts to prevent race conditions
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);

    if (open) return;

    // Set a timeout to open the popover
    openTimeoutRef.current = setTimeout(() => {
      buttonRef.current?.click();
    }, 150); // Small delay before opening
  };

  const onMouseLeave = (close: () => void) => {
    if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);

    // set a timeout to close the popover
    timeoutRef.current = setTimeout(() => {
      close();
    }, 200); // small delay before closing allows moving mouse to the panel
  };

  const Icon =
    variant === 'solid'
      ? SolidInformationCircleIcon
      : OutlineInformationCircleIcon;

  return (
    <Popover as="div" className="relative inline-block w-max">
      {({ open, close }) => (
        <div
          onMouseEnter={() => onMouseEnter(open)}
          onMouseLeave={() => onMouseLeave(close)}
        >
          <PopoverButton
            ref={buttonRef}
            as={as ?? 'button'}
            className="flex focus:outline-none"
          >
            {children ? children : <Icon className="h-[18px] w-[18px]" />}
          </PopoverButton>

          {open && (
            <PopoverPanel
              static
              portal
              anchor={{
                to:
                  placement === 'right'
                    ? align === 'center'
                      ? 'right'
                      : 'right start'
                    : align === 'center'
                      ? 'bottom'
                      : 'bottom start',
                gap: 8,
              }}
              className="z-[9999] w-max max-w-[20rem]"
            >
              <div className="rounded-lg shadow-lg ring-1 ring-black ring-opacity-5">
                <div className="bg-gray-800 text-white text-xs p-1.5 rounded-lg break-words font-normal max-w-[20rem]">
                  {content}
                </div>
              </div>
            </PopoverPanel>
          )}
        </div>
      )}
    </Popover>
  );
};

export default Tooltip;
