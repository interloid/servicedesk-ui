"use client";

import Link from "next/link";
import { Customer } from "../services/customers.service";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";

interface CustomersTableProps {
  tenant: string;
  initialCustomers: Customer[];
}

export default function CustomersTable({
  tenant,
  initialCustomers,
}: CustomersTableProps) {
  const getInitials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s.charAt(0).toUpperCase())
      .join("");

  const formatDate = (value?: string) =>
    value
      ? new Date(value).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  return (
    <div className="h-full bg-slate-50/50 p-4 font-sans text-slate-700 ">
      <div className="mx-auto max-w space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Customers
            </h1>

            <p className="mt-1 text-xs text-slate-500">
              Companies and the people who raise tickets from them.
            </p>

            <p className="mt-1 text-xs text-slate-400">
              Tenant: {tenant} · {initialCustomers.length} customers
            </p>
          </div>

          <Button
            size="sm"
            className="h-9 bg-teal-800 text-xs font-semibold hover:bg-teal-900"
          >
            Add company
          </Button>
        </div>

        <Card className="overflow-hidden rounded-xl border-slate-200/80 shadow-sm p-0">
          <CardContent className="p-0">
            {initialCustomers.length === 0 ? (
              <div className="flex min-h-70 items-center justify-center p-12 text-center">
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    No customers yet
                  </p>

                  <p className="mt-1 text-xs text-slate-400">
                    Customers appear here when they are added in this workspace.
                  </p>

                  <Button
                    size="sm"
                    className="mt-4 bg-teal-800 text-xs hover:bg-teal-900"
                  >
                    Add company
                  </Button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/70">
                    <TableRow className="border-slate-100 hover:bg-transparent">
                      <TableHead className="h-11 px-6 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Customer
                      </TableHead>

                      <TableHead className="h-11 px-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Email
                      </TableHead>

                      <TableHead className="h-11 px-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Company
                      </TableHead>

                      <TableHead className="h-11 px-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Phone
                      </TableHead>

                      <TableHead className="h-11 px-6 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Added
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {initialCustomers.map((customer) => (
                      <TableRow
                        key={customer.id}
                        className="border-slate-100 transition-colors hover:bg-slate-50/60"
                      >
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 rounded-lg">
                              <AvatarFallback className="rounded-lg bg-teal-50 text-[10px] font-bold text-teal-800">
                                {getInitials(customer.full_name)}
                              </AvatarFallback>
                            </Avatar>

                            <Link
                              href={`/${tenant}/customers/${customer.id}`}
                              className="font-bold text-slate-900 transition-colors hover:text-teal-800 hover:underline"
                            >
                              {customer.full_name}
                            </Link>
                          </div>
                        </TableCell>

                        <TableCell className="px-4 py-4 text-slate-600">
                          {customer.email}
                        </TableCell>

                        <TableCell className="px-4 py-4 text-slate-700">
                          {customer.company || "—"}
                        </TableCell>

                        <TableCell className="px-4 py-4 text-slate-700">
                          {customer.phone || "—"}
                        </TableCell>

                        <TableCell className="px-6 py-4 text-slate-500">
                          {formatDate(customer.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
