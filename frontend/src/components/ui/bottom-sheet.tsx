"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

const BottomSheet = DialogPrimitive.Root

const BottomSheetTrigger = React.forwardRef<
  HTMLButtonElement,
  DialogPrimitive.Trigger.Props
>((props, ref) => (
  <DialogPrimitive.Trigger ref={ref} {...props} />
))
BottomSheetTrigger.displayName = "BottomSheetTrigger"

const BottomSheetContent = React.forwardRef<
  HTMLDivElement,
  DialogPrimitive.Popup.Props & { title: string }
>(({ className, children, title, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-black/40 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-200" />
    <DialogPrimitive.Popup
      ref={ref}
      aria-label={title}
      className={cn(
        "fixed bottom-0 inset-x-0 z-50 flex flex-col bg-background rounded-t-2xl ring-1 ring-foreground/10 outline-none",
        "max-h-[88dvh]",
        "data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom duration-250",
        className
      )}
      {...props}
    >
      <div className="flex justify-center pt-3 pb-1 shrink-0">
        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
      </div>
      <div className="flex items-center justify-between px-4 pb-3 shrink-0">
        <DialogPrimitive.Title className="font-semibold text-base">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Close
          render={<Button variant="ghost" size="icon-sm" />}
        >
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>
      {children}
    </DialogPrimitive.Popup>
  </DialogPrimitive.Portal>
))
BottomSheetContent.displayName = "BottomSheetContent"

export { BottomSheet, BottomSheetTrigger, BottomSheetContent }
