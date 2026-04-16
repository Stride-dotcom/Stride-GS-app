import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      closeButton={true}
      duration={3000}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-gradient-to-b group-[.toaster]:from-white group-[.toaster]:to-[#f9fafb] group-[.toaster]:text-foreground group-[.toaster]:border group-[.toaster]:border-border/50 group-[.toaster]:shadow-[0_4px_12px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] group-[.toaster]:rounded-md group-[.toaster]:py-3 group-[.toaster]:px-4",
          title: "group-[.toast]:font-semibold group-[.toast]:text-gray-900",
          description: "group-[.toast]:text-gray-600 group-[.toast]:font-medium",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:rounded-md",
          closeButton: "group-[.toast]:bg-transparent group-[.toast]:border-none group-[.toast]:text-gray-400 group-[.toast]:hover:text-gray-600",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
