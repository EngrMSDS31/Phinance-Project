import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function Settings() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and app preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fee &amp; Tax Rates</CardTitle>
          <CardDescription>
            Fee and tax rates are now managed per portfolio. Open any portfolio, click the edit icon, and set the default fee % and tax % for that portfolio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/40 rounded-md p-4 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How portfolio rates work</p>
            <ul className="list-disc pl-4 space-y-1 mt-2">
              <li>Fee % applies to BUY and SELL transactions (e.g. 0.295 = 0.295% of total amount).</li>
              <li>Tax % applies to DIVIDEND and income transactions (e.g. 10 = 10% withholding).</li>
              <li>Both values support up to 4 decimal places for precision.</li>
              <li>You can always override the calculated amount for any individual transaction.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
          <CardDescription>Currency and theme settings are accessible from the top bar.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the currency selector in the top bar to change your display currency. Use the sun/moon icon to toggle between dark and light mode.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
