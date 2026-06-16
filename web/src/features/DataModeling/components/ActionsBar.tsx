import {
  ChartBarIcon,
  FunnelIcon,
  RectangleGroupIcon,
  Square3Stack3DIcon,
} from '@heroicons/react/24/solid';
import { Button, DialogBox, Icon } from '@web/elements';
import { mapActionTypeToGuideStep } from '@web/features/Tutorial/config/assistMe/assistSteps';
import { useModelStore } from '@web/stores/useModelStore';
import { useTutorialStore } from '@web/stores/useTutorialStore';
import { Panel } from '@xyflow/react';
import React, { useCallback, useMemo } from 'react';

import { ActionType } from '../types';
import { HoverTooltip } from './HoverTooltip';

type Action = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
  type: ActionType;
};

const actionDefinitions: Action[] = [
  {
    label: 'Add Lightdash',
    icon: ChartBarIcon,
    title: 'Click to toggle Lightdash analytics',
    type: ActionType.LIGHTDASH,
  },
  {
    label: 'Add Group By',
    icon: RectangleGroupIcon,
    title: 'Click to toggle Group By aggregation',
    type: ActionType.GROUPBY,
  },
  {
    label: 'Add Where',
    icon: FunnelIcon,
    title: 'Click to toggle Where conditions',
    type: ActionType.WHERE,
  },
  {
    label: 'Add CTEs',
    icon: Square3Stack3DIcon,
    title: 'Click to toggle CTE list',
    type: ActionType.CTE,
  },
];

interface ActionsBarProps {
  actionTypes: ActionType[];
}

export const ActionsBar: React.FC<ActionsBarProps> = ({ actionTypes }) => {
  const {
    toggleAction,
    isActionActive,
    pendingRemovalAction,
    setPendingRemovalAction,
    modelingState,
  } = useModelStore();

  // Tutorial store integration
  const {
    isPlayTutorialActive,
    tutorialActiveActions,
    assistModeEnabled,
    currentAssistStepIndex,
    setDataModelingGuideStep,
  } = useTutorialStore((state) => ({
    isPlayTutorialActive: state.isPlayTutorialActive,
    tutorialActiveActions: state.tutorialActiveActions,
    assistModeEnabled: state.assistModeEnabled,
    currentAssistStepIndex: state.currentAssistStepIndex,
    setDataModelingGuideStep: state.setDataModelingGuideStep,
  }));

  const disabled =
    !modelingState.from.model &&
    !modelingState.from.source &&
    !modelingState.from.cte;

  // Memoize filtered actions based on available action types
  const enabledActions = useMemo(
    () =>
      actionDefinitions.filter((action) => actionTypes.includes(action.type)),
    [actionTypes],
  );

  const onActionClick = useCallback(
    (action: Action) => {
      // CTEs sit upstream of the SELECT FROM picker, so the user may want
      // to declare them before picking a source -- skip the from-required
      // gate for CTE only.
      if (disabled && action.type !== ActionType.CTE) return;

      // During tutorial, prevent user from toggling actions
      if (isPlayTutorialActive) {
        return;
      }

      if (isActionActive(action.type)) {
        // Show confirmation dialog before removing
        setPendingRemovalAction(action.type);
      } else {
        // Enable action
        toggleAction(action.type);

        // Always show guide when action is toggled on (not just when assist mode is active)
        // This provides helpful context even for users not using the full assist mode
        setTimeout(() => {
          const guideStep = mapActionTypeToGuideStep(action.type);
          setDataModelingGuideStep(guideStep);
        }, 1000); // Wait for the action to be toggled, node to appear, and state to update
      }
    },
    [
      toggleAction,
      isActionActive,
      setPendingRemovalAction,
      disabled,
      isPlayTutorialActive,
      assistModeEnabled,
      currentAssistStepIndex,
      setDataModelingGuideStep,
    ],
  );

  const handleRemoveConfirm = useCallback(() => {
    if (pendingRemovalAction) {
      toggleAction(pendingRemovalAction);
    }
  }, [pendingRemovalAction, toggleAction]);

  const handleRemoveCancel = useCallback(() => {
    setPendingRemovalAction(null);
  }, [setPendingRemovalAction]);

  const getActionLabel = (actionType: ActionType): string => {
    const labels: Record<ActionType, string> = {
      [ActionType.WHERE]: 'Where Clause',
      [ActionType.GROUPBY]: 'Group By',
      [ActionType.LIGHTDASH]: 'Lightdash',
      [ActionType.CTE]: 'CTEs',
    };
    return labels[actionType] || 'this action';
  };

  return (
    <Panel position="center-left" style={{ top: '20%' }}>
      <div
        className="bg-card border border-surface rounded-sm shadow-sm"
        data-tutorial-id="actions-bar"
      >
        {/* Title */}
        <div className="px-2 py-2 border-b border-surface bg-primary/10 flex items-center justify-center">
          <HoverTooltip
            content="Actions"
            description="Optional transformations to your model"
            placement="right"
          >
            <Icon name="add" className="w-4 h-4 text-background-contrast" />
          </HoverTooltip>
        </div>

        {/* Action Items */}
        <div className="flex flex-col">
          {enabledActions.map((action) => {
            // Use tutorial state when tutorial is active
            const isChecked = isPlayTutorialActive
              ? tutorialActiveActions.has(action.type)
              : isActionActive(action.type);
            // Get the action label, replacing "Add" with "Remove" if checked
            const tooltipLabel =
              isChecked && action.label.startsWith('Add ')
                ? action.label.replace('Add ', 'Remove ')
                : action.label;

            // CTE bypasses the from-required gate (declared upstream of
            // SELECT FROM, so the user may want to set it up first).
            const actionDisabled = disabled && action.type !== ActionType.CTE;

            return (
              <HoverTooltip
                key={action.type}
                content={tooltipLabel}
                disabled={actionDisabled}
                placement="right"
              >
                <Button
                  variant="iconButton"
                  label=""
                  onClick={() => onActionClick(action)}
                  disabled={actionDisabled}
                  className={`
                    flex flex-col items-center justify-center py-2 px-1 transition-all duration-200 group w-full
                    ${
                      actionDisabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer hover:bg-surface/50'
                    }
                  `}
                  icon={
                    <action.icon
                      className={`w-4 h-4 mb-1 transition-colors ${
                        isChecked
                          ? 'text-primary'
                          : 'text-background-contrast group-hover:text-primary'
                      }`}
                    />
                  }
                  data-tutorial-id={`action-${action.type.toLowerCase()}`}
                />
              </HoverTooltip>
            );
          })}
        </div>
      </div>
      {/* Remove Dialog */}
      {pendingRemovalAction && (
        <DialogBox
          open={true}
          title={`Remove ${getActionLabel(pendingRemovalAction)}?`}
          description={`Are you sure you want to remove the ${getActionLabel(pendingRemovalAction).toLowerCase()}? Any configured ${getActionLabel(pendingRemovalAction).toLowerCase()} data will be lost.`}
          onConfirm={handleRemoveConfirm}
          onDiscard={handleRemoveCancel}
          confirmCTALabel="Remove"
          discardCTALabel="Cancel"
        />
      )}
    </Panel>
  );
};
