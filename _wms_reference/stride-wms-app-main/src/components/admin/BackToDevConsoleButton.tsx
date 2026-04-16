import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

interface BackToDevConsoleButtonProps {
  label?: string;
}

export function BackToDevConsoleButton({
  label = "Back to Dev Console",
}: BackToDevConsoleButtonProps) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to="/settings?tab=dev-console">
        <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
        {label}
      </Link>
    </Button>
  );
}

