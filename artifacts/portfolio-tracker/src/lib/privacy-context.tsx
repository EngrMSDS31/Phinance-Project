import { createContext, useContext, useState } from "react";

interface PrivacyContextType {
  showAmounts: boolean;
  toggleShowAmounts: () => void;
}

const PrivacyContext = createContext<PrivacyContextType>({
  showAmounts: true,
  toggleShowAmounts: () => {},
});

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [showAmounts, setShowAmounts] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("folio-show-amounts");
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  const toggleShowAmounts = () => {
    setShowAmounts(prev => {
      const next = !prev;
      try { localStorage.setItem("folio-show-amounts", String(next)); } catch {}
      return next;
    });
  };

  return (
    <PrivacyContext.Provider value={{ showAmounts, toggleShowAmounts }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
