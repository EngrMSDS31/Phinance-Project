import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useImportCsv, useListPortfolios } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Upload, Eye, FolderOpen, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const SAMPLE_CSV = `Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,FeeCurrency,DoNotAdjustCash,Note
CASH_IN,1/1/2024,PHP,1,50000,PHP,0,,PHP,FALSE,Initial deposit
BUY,1/15/2024,AAPL,150.00,10,USD,7.50,US,USD,FALSE,
BUY,2/1/2024,TEL,1200.00,100,PHP,300.00,PSE,PHP,FALSE,COL Financial
BUY,3/10/2024,BTC,45000.00,0.5,USD,0,CRYPTO,USD,FALSE,
DIVIDEND,4/5/2024,AAPL,0.25,10,USD,0.68,US,USD,FALSE,Q1 dividend
SELL,5/1/2024,AAPL,170.00,5,USD,4.25,US,USD,FALSE,Partial exit
CASH_OUT,6/1/2024,PHP,1,10000,PHP,0,,PHP,FALSE,Withdrawal`;

const STANDARD_CSV = `Date,Type,Symbol,Name,Market,Quantity,Price,Amount,Fee,Tax,Currency,Notes
2024-01-15,BUY,AAPL,Apple Inc.,US,10,150.00,1500.00,7.50,,USD,
2024-02-01,BUY,TEL,PLDT Inc.,PSE,100,1200.00,120000.00,300.00,1800.00,PHP,
2024-03-10,BUY,BTC,Bitcoin,CRYPTO,0.5,45000.00,22500.00,,,USD,
2024-04-05,DIVIDEND,AAPL,Apple Inc.,US,,,4.50,,0.68,USD,Q1 dividend
2024-05-01,SELL,AAPL,Apple Inc.,US,5,170.00,850.00,4.25,,USD,Partial exit`;

export default function CsvImportExport() {
  const { toast } = useToast();
  const importCsv = useImportCsv();
  const { data: portfolios } = useListPortfolios();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [csvContent, setCsvContent] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [importPortfolio, setImportPortfolio] = useState<string>("");
  const [exportPortfolio, setExportPortfolio] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      toast({ title: "Please select a .csv file", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvContent(text);
      setImportResult(null);
      toast({ title: `File loaded: ${file.name}`, description: `${text.split("\n").length - 1} data rows detected.` });
    };
    reader.readAsText(file);
    // reset so same file can be re-selected
    e.target.value = "";
  };

  const handlePreview = () => {
    if (!csvContent.trim()) {
      toast({ title: "No CSV data. Choose a file or paste data below.", variant: "destructive" });
      return;
    }
    if (!importPortfolio) {
      toast({ title: "Select a target portfolio first.", variant: "destructive" });
      return;
    }
    importCsv.mutate(
      { portfolioId: parseInt(importPortfolio), data: { csvContent, dryRun: true } },
      {
        onSuccess: (data) => {
          setImportResult(data as any);
          toast({ title: "Preview ready" });
        },
        onError: () => {
          toast({ title: "Failed to parse CSV", variant: "destructive" });
        },
      }
    );
  };

  const handleImport = () => {
    if (!csvContent.trim()) {
      toast({ title: "No CSV data. Choose a file or paste data below.", variant: "destructive" });
      return;
    }
    if (!importPortfolio) {
      toast({ title: "Select a target portfolio first.", variant: "destructive" });
      return;
    }
    importCsv.mutate(
      { portfolioId: parseInt(importPortfolio), data: { csvContent, dryRun: false } },
      {
        onSuccess: (data) => {
          const result = data as any;
          setImportResult(result);
          toast({
            title: result.errors?.length ? "Import completed with warnings" : "Import successful",
            description: `${result.imported} rows imported, ${result.skipped} skipped.`,
          });
          if (!result.errors?.length) {
            setCsvContent("");
            setFileName(null);
          }
        },
        onError: () => {
          toast({ title: "Import failed", variant: "destructive" });
        },
      }
    );
  };

  const handleExport = async () => {
    if (!exportPortfolio) {
      toast({ title: "Select a portfolio to export.", variant: "destructive" });
      return;
    }
    setIsExporting(true);
    try {
      const resp = await fetch(`${BASE_URL}/api/portfolios/${exportPortfolio}/csv/export`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error("Export failed");
      const { csvContent: csv, filename } = await resp.json();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "folio-export.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import / Export</h1>
        <p className="text-muted-foreground">Bulk upload transactions via CSV or export your data.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Card */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> Import CSV</CardTitle>
            <CardDescription>Load from your device or paste CSV data directly.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col space-y-4">
            {/* File picker */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleFileSelect}>
                <FolderOpen className="w-4 h-4 mr-2" />
                {fileName ? `${fileName}` : "Choose CSV File"}
              </Button>
              {fileName && (
                <Button variant="ghost" size="sm" onClick={() => { setCsvContent(""); setFileName(null); setImportResult(null); }}>
                  Clear
                </Button>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center gap-2 px-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground shrink-0">or paste below</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>

            <div className="space-y-2 pt-4">
              <label className="text-sm font-medium">Target Portfolio</label>
              <Select value={importPortfolio} onValueChange={setImportPortfolio}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Portfolio" />
                </SelectTrigger>
                <SelectContent>
                  {portfolios?.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Supported formats:</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => { setCsvContent(SAMPLE_CSV); setFileName(null); setImportResult(null); }}
                >
                  Load broker template
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => { setCsvContent(STANDARD_CSV); setFileName(null); setImportResult(null); }}
                >
                  Load standard format
                </button>
              </div>
            </div>
            <Textarea
              placeholder={SAMPLE_CSV}
              className="flex-1 min-h-[160px] font-mono text-xs bg-muted/50"
              value={csvContent}
              onChange={(e) => { setCsvContent(e.target.value); setFileName(null); setImportResult(null); }}
            />

            {importResult && (
              <div className="bg-muted/60 border border-border p-4 rounded-md text-sm space-y-2">
                <div className="font-semibold">Import Result</div>
                <div className="flex gap-4">
                  <span className="flex items-center gap-1 text-gain">
                    <CheckCircle className="w-4 h-4" /> {importResult.imported} imported
                  </span>
                  {importResult.skipped > 0 && (
                    <span className="flex items-center gap-1 text-amber-400">
                      <AlertTriangle className="w-4 h-4" /> {importResult.skipped} skipped
                    </span>
                  )}
                </div>
                {importResult.errors?.length > 0 && (
                  <div className="text-destructive">
                    <div className="flex items-center gap-1 mb-1"><XCircle className="w-4 h-4" /> Errors:</div>
                    <ul className="list-disc pl-5 space-y-0.5 text-xs">
                      {importResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                      {importResult.errors.length > 5 && <li>...and {importResult.errors.length - 5} more</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handlePreview} disabled={importCsv.isPending}>
                <Eye className="w-4 h-4 mr-2" /> Preview
              </Button>
              <Button onClick={handleImport} disabled={importCsv.isPending}>
                {importCsv.isPending ? "Importing..." : "Import Data"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Export Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Download className="w-5 h-5" /> Export Data</CardTitle>
            <CardDescription>Download your complete transaction history as CSV.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Portfolio to Export</label>
              <Select value={exportPortfolio} onValueChange={setExportPortfolio}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Portfolio" />
                </SelectTrigger>
                <SelectContent>
                  {portfolios?.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="bg-muted/50 rounded-md p-4 text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">CSV Format</p>
              <p>Exports all transactions with columns:</p>
              <code className="text-xs block bg-muted rounded p-2 text-foreground">
                Date, Type, Symbol, Name, Market, Quantity, Price, Amount, Fee, Tax, Currency, Notes
              </code>
              <p className="text-xs">Use the same format for imports.</p>
            </div>

            <Button onClick={handleExport} className="w-full" disabled={isExporting || !exportPortfolio}>
              <Download className="w-4 h-4 mr-2" /> {isExporting ? "Exporting..." : "Export to CSV"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
