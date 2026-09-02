"use client";

import Link from "next/link";
import { Customer } from "../services/customers.service";

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
    <div className="h-full bg-slate-50/50 p-8 font-sans text-slate-700">
      <div className="max-w mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
            <p className="text-xs text-slate-500 mt-1">
              Companies and the people who raise tickets from them.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Tenant: {tenant} · {initialCustomers.length} customers
            </p>
          </div>
          <button className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg shadow-sm transition-colors">
            Add company
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            {initialCustomers.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  No customers yet
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Customers appear here when they are added in this workspace.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/50 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 text-[10px]">
                  <tr>
                    <th className="py-3 px-6">Customer</th>
                    <th className="py-3 px-4">Email</th>
                    <th className="py-3 px-4">Company</th>
                    <th className="py-3 px-4">Phone</th>
                    <th className="py-3 px-6">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {initialCustomers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-800 border border-teal-100 flex items-center justify-center text-[10px] font-bold">
                            {getInitials(customer.full_name)}
                          </div>
                          <div>
                            <Link
                              href={`/${tenant}/customers/${customer.id}`}
                              className="font-bold text-slate-900 hover:text-teal-800 hover:underline transition-colors"
                            >
                              {customer.full_name}
                            </Link>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4 text-slate-600">
                        {customer.email}
                      </td>

                      <td className="py-4 px-4 text-slate-700">
                        {customer.company || "—"}
                      </td>

                      <td className="py-4 px-4 text-slate-700">
                        {customer.phone || "—"}
                      </td>

                      <td className="py-4 px-6 text-slate-500">
                        {formatDate(customer.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
