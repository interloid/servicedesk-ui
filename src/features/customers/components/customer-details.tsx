"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerDetail, CustomerTicket } from "../services/customers.service";

interface CustomerDetailProps {
  customer: CustomerDetail;
  tenant: string;
}

export default function CustomerDetailPage({
  customer,
  tenant,
}: CustomerDetailProps) {
  const getInitials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s.charAt(0).toUpperCase())
      .join("");

  const customerSince = customer.created_at
    ? new Date(customer.created_at).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      })
    : "—";

  const getTicketStatusBadge = (status: CustomerTicket["status"]) => {
    switch (status) {
      case "new":
        return (
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 font-semibold text-xs px-2.5 py-0.5 rounded-full border-0">
            New
          </Badge>
        );
      case "open":
        return (
          <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 font-semibold text-xs px-2.5 py-0.5 rounded-full border-0 gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-600 inline-block" />
            Open
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-semibold text-xs px-2.5 py-0.5 rounded-full border-0 gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600 inline-block" />
            Pending
          </Badge>
        );
      case "on_hold":
        return (
          <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 font-semibold text-xs px-2.5 py-0.5 rounded-full border-0">
            On hold
          </Badge>
        );
      case "resolved":
        return (
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 font-semibold text-xs px-2.5 py-0.5 rounded-full border-0 gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block" />
            Resolved
          </Badge>
        );
      case "closed":
        return (
          <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 font-semibold text-xs px-2.5 py-0.5 rounded-full border-0">
            Closed
          </Badge>
        );
    }
  };

  return (
    <div className="h-full bg-slate-50/50 lg:p-8 font-sans text-slate-700">
      <div className="max-w mx-auto space-y-6">
        <div>
          <Link
            href={`/${tenant}/customers`}
            className="inline-flex items-center text-xs font-semibold text-teal-700 hover:text-teal-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 mr-0.5" />
            Customers
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center space-x-4">
            <Avatar className="h-12 w-12 rounded-xl bg-slate-900 text-white shrink-0">
              <AvatarFallback className="rounded-xl bg-slate-900 text-white font-bold text-sm">
                {getInitials(customer.full_name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {customer.full_name}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {customer.company || customer.email} · Customer since{" "}
                {customerSince}
              </p>
            </div>
          </div>
          {customer.company && (
            <div className="self-start sm:self-auto">
              <Badge className="bg-teal-50 text-teal-800 hover:bg-teal-50 border border-teal-100/60 font-medium text-xs px-3 py-1 rounded-full">
                {customer.company}
              </Badge>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white p-5 ring-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Open Tickets
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-2">
              {customer.openTicketsCount}
            </p>
          </Card>

          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white p-5 ring-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Lifetime Tickets
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-2">
              {customer.lifetimeTicketsCount}
            </p>
          </Card>

          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white p-5 ring-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Email
            </p>
            <p className="text-sm font-bold text-slate-900 mt-2.5 break-all">
              {customer.email}
            </p>
          </Card>

          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white p-5 ring-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              CSAT
            </p>
            <p className="text-base font-bold text-slate-900 mt-2.5">{"N/A"}</p>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden ring-0">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 space-y-0">
              <CardTitle className="text-sm font-bold text-slate-900">
                Contacts & portal access
              </CardTitle>
              <Button
                variant="outline"
                className="text-teal-800 border-teal-200 hover:bg-teal-50 hover:text-teal-900 text-xs font-semibold h-8 px-3 rounded-lg"
              >
                Invite contact
              </Button>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-100">
              {customer.contacts.length === 0 ? (
                <p className="p-5 text-xs text-slate-400">
                  No other contacts at this company yet.
                </p>
              ) : (
                customer.contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
                  >
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">
                        {contact.name}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {contact.email}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      {contact.status === "active" ? (
                        <Badge className="bg-emerald-100/70 text-emerald-800 hover:bg-emerald-100/70 font-semibold text-xs px-2.5 py-0.5 rounded-full border-0">
                          Portal active
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100/60 text-amber-900 hover:bg-amber-100/60 font-semibold text-xs px-2.5 py-0.5 rounded-md border-0">
                          Invited
                        </Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border border-slate-200/80 shadow-sm bg-white overflow-hidden ring-0">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="text-sm font-bold text-slate-900">
                Recent tickets
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-100">
              {customer.recentTickets.length === 0 ? (
                <p className="p-5 text-xs text-slate-400">
                  No tickets raised by this customer yet.
                </p>
              ) : (
                customer.recentTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/${tenant}/tickets/${ticket.id}`}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
                  >
                    <div>
                      <span className="text-xs text-slate-400 font-normal">
                        #{ticket.number ?? ticket.id.substring(0, 4)}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 mt-0.5">
                        {ticket.subject}
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {new Date(ticket.created_at).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                      </p>
                    </div>
                    <div className="self-start sm:self-auto">
                      {getTicketStatusBadge(ticket.status)}
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
