import { makeClassName } from '@web';
import { useMemo } from 'react';

export type BoxProps = React.ComponentProps<'div'> & {
  variant?: 'bordered' | 'padded';
};

export function Box({
  children,
  className: classNameProp,
  variant,
  ...props
}: BoxProps) {
  const className = useMemo(() => {
    let _className: React.ComponentProps<'div'>['className'] =
      classNameProp || '';
    switch (variant) {
      case 'bordered': {
        _className = makeClassName(
          _className,
          'border-2',
          'border-solid',
          'p-2',
          'rounded-md',
        );
        break;
      }
      case 'padded': {
        _className = makeClassName(_className, 'p-2');
        break;
      }
    }
    return _className;
  }, [classNameProp, variant]);

  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}
