import { createContext, useContext, ReactNode, useCallback } from 'react';
import { useGuidedPrompts } from '@/hooks/useGuidedPrompts';
import { PromptModal } from './PromptModal';
import { PromptSlidePanel } from './PromptSlidePanel';
import { PromptToast } from './PromptToast';
import { HelpPanelWithContext } from './HelpPanel';
import {
  GuidedPrompt,
  PromptWorkflow,
  PromptTriggerPoint,
  PromptContext,
  PromptLevel,
  CompetencyEventType,
  UserPromptSettings,
} from '@/types/guidedPrompts';

interface PromptContextValue {
  // State
  userSettings: UserPromptSettings | null;
  promptLevel: PromptLevel;
  isLoading: boolean;
  prompts: GuidedPrompt[];

  // Prompt functions
  getPromptsForWorkflow: (workflow: PromptWorkflow, triggerPoint?: PromptTriggerPoint) => GuidedPrompt[];
  showPrompt: (promptKey: string, context?: PromptContext) => boolean;
  shouldShowPrompt: (prompt: GuidedPrompt) => boolean;

  // Competency
  trackCompetencyEvent: (workflow: PromptWorkflow, eventType: CompetencyEventType) => Promise<void>;

  // Help panel
  isHelpPanelOpen: boolean;
  helpPanelWorkflow: PromptWorkflow | null;
  openHelpPanel: (workflow: PromptWorkflow) => void;
  closeHelpPanel: () => void;
}

const PromptCtx = createContext<PromptContextValue | null>(null);

export function usePromptContext(): PromptContextValue {
  const context = useContext(PromptCtx);
  if (!context) {
    throw new Error('usePromptContext must be used within a PromptProvider');
  }
  return context;
}

// Safe hook that returns null values if not in provider (for conditional usage)
export function usePromptContextSafe(): PromptContextValue | null {
  return useContext(PromptCtx);
}

interface PromptProviderProps {
  children: ReactNode;
}

export function PromptProvider({ children }: PromptProviderProps) {
  const {
    userSettings,
    promptLevel,
    isLoading,
    prompts,
    getPromptsForWorkflow,
    showPrompt,
    shouldShowPrompt,
    acknowledgePrompt,
    activePrompt,
    dismissActivePrompt,
    trackCompetencyEvent,
    isHelpPanelOpen,
    helpPanelWorkflow,
    openHelpPanel,
    closeHelpPanel,
  } = useGuidedPrompts();

  const handleConfirm = useCallback((checklistState?: Record<string, boolean>) => {
    if (activePrompt) {
      acknowledgePrompt(
        activePrompt.prompt.id,
        true,
        checklistState,
        activePrompt.context
      );
    }
  }, [activePrompt, acknowledgePrompt]);

  const handleCancel = useCallback(() => {
    if (activePrompt) {
      acknowledgePrompt(
        activePrompt.prompt.id,
        false,
        undefined,
        activePrompt.context
      );
    }
  }, [activePrompt, acknowledgePrompt]);

  const handleSkip = useCallback(() => {
    dismissActivePrompt();
  }, [dismissActivePrompt]);

  const contextValue: PromptContextValue = {
    userSettings,
    promptLevel,
    isLoading,
    prompts,
    getPromptsForWorkflow,
    showPrompt,
    shouldShowPrompt,
    trackCompetencyEvent,
    isHelpPanelOpen,
    helpPanelWorkflow,
    openHelpPanel,
    closeHelpPanel,
  };

  // Render the active prompt based on type
  const renderActivePrompt = () => {
    if (!activePrompt) return null;

    const { prompt, context } = activePrompt;

    switch (prompt.prompt_type) {
      case 'modal':
        return (
          <PromptModal
            prompt={prompt}
            context={context}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            onSkip={handleSkip}
          />
        );
      case 'slide_panel':
        return (
          <PromptSlidePanel
            prompt={prompt}
            context={context}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            onSkip={handleSkip}
          />
        );
      case 'toast':
        return (
          <PromptToast
            prompt={prompt}
            context={context}
            onDismiss={dismissActivePrompt}
          />
        );
      case 'tooltip':
        // Tooltips are handled inline, not through the provider
        return null;
      default:
        return null;
    }
  };

  return (
    <PromptCtx.Provider value={contextValue}>
      {children}
      {renderActivePrompt()}
      <HelpPanelWithContext />
    </PromptCtx.Provider>
  );
}
