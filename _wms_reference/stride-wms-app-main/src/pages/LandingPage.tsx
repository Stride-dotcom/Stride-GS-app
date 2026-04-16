import { Link } from 'react-router-dom';
import { Package, Truck, Receipt, Users, Shield, MessageSquare, ArrowRight, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  { icon: Package, title: 'Inventory Tracking', desc: 'Real-time visibility into every item across your warehouse with barcode scanning and location management.' },
  { icon: Truck, title: 'Shipment Management', desc: 'Streamline inbound receiving and outbound releases with manifest tracking and exception handling.' },
  { icon: Receipt, title: 'Billing & Invoicing', desc: 'Automated billing events, customizable rate cards, and professional invoice generation.' },
  { icon: Users, title: 'Client Portal', desc: 'Give your clients self-service access to view inventory, request shipments, and track orders.' },
  { icon: Shield, title: 'Claims & Coverage', desc: 'Manage damage claims, coverage plans, and repair workflows all in one place.' },
  { icon: MessageSquare, title: 'SMS Alerts', desc: 'Keep clients informed with automated text notifications for shipment updates and inventory changes.' },
];

const steps = [
  { num: '01', title: 'Sign Up', desc: 'Create your account and configure your organization in minutes.' },
  { num: '02', title: 'Set Up Your Warehouse', desc: 'Define locations, item types, pricing rules, and client accounts.' },
  { num: '03', title: 'Start Managing', desc: 'Receive shipments, track inventory, generate invoices, and delight your clients.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-xl font-bold tracking-tight text-primary">StrideWMS</span>
          <div className="flex items-center gap-3">
            <Link to="/sms">
              <Button variant="ghost" size="sm">SMS Info</Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Sign In <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6">
            Modern Warehouse Management
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
            Streamline operations for your 3PL business. Track inventory, process shipments,
            automate billing, and give your clients the visibility they deserve.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/auth">
              <Button size="lg">
                Get Started <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <a href="#features">
              <Button variant="outline" size="lg">Learn More</Button>
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">Everything You Need</h2>
          <p className="text-muted-foreground text-center mb-12 max-w-xl mx-auto">
            A complete platform built specifically for third-party logistics providers.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <f.icon className="h-8 w-8 text-primary mb-4" />
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-sm mb-4">
                  {s.num}
                </div>
                <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 bg-primary/5">
        <div className="max-w-2xl mx-auto text-center">
          <CheckCircle className="h-10 w-10 text-primary mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-muted-foreground mb-8">
            Join warehouse operators who trust StrideWMS to run their day-to-day operations.
          </p>
          <Link to="/auth">
            <Button size="lg">
              Create Your Account <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} StrideWMS. All rights reserved.</span>
          <div className="flex gap-6">
            <Link to="/sms" className="hover:text-foreground transition-colors">SMS Program Info</Link>
            <Link to="/auth" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
