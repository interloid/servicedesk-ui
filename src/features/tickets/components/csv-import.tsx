"use client";

import React, { useState, useRef } from "react";
import { Upload, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TARGET_FIELDS = [
  { value: "subject", label: "subject" },
  { value: "requester", label: "requester" },
  { value: "company", label: "company" },
  { value: "priority", label: "priority" },
  { value: "assignee", label: "assignee" },
  { value: "created_at", label: "created_at" },
  { value: "skip", label: "— skip —" },
];

interface FileDetails {
  name: string;
  rows: number;
  columns: number;
  size: string;
}

interface MappingRow {
  csvHeader: string;
  mappedField: string;
}
interface TicketImportWizardProps {
  onBack: () => void;
}

export default function TicketImportWizard({
  onBack,
}: TicketImportWizardProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<FileDetails | null>({
    name: "zendesk-export-jul26.csv",
    rows: 412,
    columns: 7,
    size: "3.2 MB",
  });
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [columnMappings, setColumnMappings] = useState<MappingRow[]>([
    { csvHeader: "Subject", mappedField: "subject" },
    { csvHeader: "Requester email", mappedField: "requester" },
    { csvHeader: "Company", mappedField: "company" },
    { csvHeader: "Urgency", mappedField: "priority" },
    { csvHeader: "Owner", mappedField: "assignee" },
    { csvHeader: "Created (UTC)", mappedField: "created_at" },
    { csvHeader: "Legacy ID", mappedField: "skip" },
  ]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile) {
      setIsUploading(true);
      setTimeout(() => {
        setFile({
          name: uploadedFile.name,
          rows: 412,
          columns: 7,
          size: `${(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB`,
        });
        setIsUploading(false);
      }, 600);
    }
  };

  const handleMappingChange = (index: number, newValue: string) => {
    setColumnMappings((prev) => {
      const next = [...prev];
      next[index].mappedField = newValue;
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 sm:p-8 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Import tickets
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Bring history over from another help desk. Nothing is written until
            you confirm.
          </p>
        </div>

        <Card className="border border-slate-200/80 shadow-sm bg-white rounded-lg">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center space-x-6 sm:space-x-8 text-xs sm:text-sm font-medium overflow-x-auto scrollbar-none whitespace-nowrap">
              <div className="flex items-center space-x-2.5">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    currentStep >= 1
                      ? "bg-teal-700 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  1
                </span>
                <span
                  className={
                    currentStep === 1
                      ? "font-bold text-slate-900"
                      : "text-slate-600"
                  }
                >
                  Upload file
                </span>
              </div>

              <div className="flex items-center space-x-2.5">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    currentStep >= 2
                      ? "bg-teal-700 text-white"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  2
                </span>
                <span
                  className={
                    currentStep === 2
                      ? "font-bold text-slate-900"
                      : "text-slate-500"
                  }
                >
                  Map columns
                </span>
              </div>

              <div className="flex items-center space-x-2.5">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    currentStep === 3
                      ? "bg-teal-700 text-white"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  3
                </span>
                <span
                  className={
                    currentStep === 3
                      ? "font-bold text-slate-900"
                      : "text-slate-500"
                  }
                >
                  Review
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {currentStep === 1 && (
          <Card className="border border-slate-200/80 shadow-sm bg-white rounded-lg p-4 sm:p-6 space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileUpload}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-slate-300 hover:border-slate-400 bg-slate-50/40 hover:bg-slate-50 rounded-lg p-10 sm:p-14 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
            >
              <Upload className="w-6 h-6 text-slate-400 mb-3 stroke-[1.75]" />
              <p className="text-sm font-semibold text-slate-800">
                Drop a CSV or export file, or browse
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Zendesk, Freshdesk and generic CSV · up to 50 MB
              </p>
            </div>

            {file && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border border-slate-200 rounded-md px-4 py-3 bg-white gap-2">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 tracking-wider">
                    CSV
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {file.rows} rows · {file.columns} columns · {file.size}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3 self-end sm:self-auto">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Parsed
                  </span>
                </div>
              </div>
            )}
          </Card>
        )}

        {currentStep === 2 && (
          <Card className="border border-slate-200/80 shadow-sm bg-white rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                Map columns to ServiceDesk fields
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {columnMappings.map((row, idx) => (
                <div
                  key={idx}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
                >
                  <span className="font-mono text-xs text-slate-800 w-full sm:w-1/3">
                    {row.csvHeader}
                  </span>

                  <div className="flex items-center space-x-3 w-full sm:w-1/2">
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    <Select
                      value={row.mappedField}
                      onValueChange={(val) => handleMappingChange(idx, val)}
                    >
                      <SelectTrigger className="h-8 text-xs font-mono text-slate-800 border-none shadow-none focus:ring-0 w-auto bg-transparent hover:bg-slate-100/60 px-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_FIELDS.map((field) => (
                          <SelectItem
                            key={field.value}
                            value={field.value}
                            className="text-xs font-mono"
                          >
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="w-full sm:w-auto flex justify-end">
                    {row.mappedField === "skip" ? (
                      <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                        Skipped
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                        Mapped
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {currentStep === 3 && (
          <Card className="border border-slate-200/80 shadow-sm bg-white rounded-lg p-5 sm:p-6 space-y-6">
            <div>
              <p className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                READY TO IMPORT
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-4">
                <div>
                  <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                    412
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Tickets</p>
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                    1,880
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Messages</p>
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                    36
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">New companies</p>
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-extrabold text-amber-600">
                    4
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Rows skipped</p>
                </div>
              </div>
            </div>

            <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg p-3.5 flex items-start space-x-3 text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <span className="font-bold">
                  4 rows have no requester email
                </span>{" "}
                and will be skipped. Imported tickets keep their original
                timestamps and are excluded from SLA reporting.
              </p>
            </div>
          </Card>
        )}

        <div className="flex items-center justify-between pt-2">
          {currentStep > 1 ? (
            <Button
              variant="outline"
              onClick={() => setCurrentStep((prev) => (prev - 1) as 1 | 2)}
              className="h-9 px-4 text-xs font-semibold border-slate-200 text-slate-700 hover:bg-slate-50 bg-white"
            >
              Back
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={onBack}
              className="h-9 px-4 text-xs font-semibold border-slate-200 text-slate-700 hover:bg-slate-50 bg-white"
            >
              Cancel
            </Button>
          )}

          {currentStep < 3 ? (
            <Button
              disabled={!file || isUploading}
              onClick={() => setCurrentStep((prev) => (prev + 1) as 2 | 3)}
              className="h-9 px-5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white shadow-sm"
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={() => alert("Import process started for 412 tickets!")}
              className="h-9 px-5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white shadow-sm"
            >
              Import 412 tickets
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
