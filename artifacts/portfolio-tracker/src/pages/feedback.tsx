import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Feedback() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      toast({ title: "Please write a message before submitting.", variant: "destructive" });
      return;
    }
    const subject = encodeURIComponent("Phinance App Feedback");
    const body = encodeURIComponent(`${email ? `From: ${email}\n\n` : ""}${message}`);
    window.open(`mailto:feedback@phinance.app?subject=${subject}&body=${body}`, "_blank");
    setSubmitted(true);
    setEmail("");
    setMessage("");
  };

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Send Feedback</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Your input helps make Phinance better for everyone.</p>
      </div>

      {submitted ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <CheckCircle className="w-12 h-12 text-gain" />
            <div className="text-center">
              <div className="font-semibold text-lg">Thanks for your feedback!</div>
              <div className="text-sm text-muted-foreground mt-1">Your email client should have opened. If not, email us directly.</div>
            </div>
            <Button variant="outline" onClick={() => setSubmitted(false)}>Send another</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="w-4 h-4" />
              Share your thoughts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Email (optional)</label>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Message</label>
                <Textarea
                  placeholder="What's working well? What could be improved?"
                  rows={6}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  className="resize-none"
                />
              </div>
              <Button type="submit" className="w-full">
                <MessageSquare className="w-4 h-4 mr-2" />
                Send Feedback
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
