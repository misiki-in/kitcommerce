<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as Dialog from "$lib/components/ui/dialog";
  import UploadCloud from "@lucide/svelte/icons/upload-cloud";
  import FileText from "@lucide/svelte/icons/file-text";
  import Check from "@lucide/svelte/icons/check";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";

  let {
    open = $bindable(false),
  }: {
    open: boolean;
  } = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let isDragging = $state(false);
  let dragCounter = 0;
  let fileName = $state("");
  let fileSize = $state("");
  let fileText = $state("");
  let detectedRows = $state(0);
  let isUploading = $state(false);

  function processFile(file: File) {
    if (!file) return;
    fileName = file.name;
    fileSize = (file.size / 1024).toFixed(1) + " KB";
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result || "");
      fileText = text;
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      detectedRows = Math.max(0, lines.length - 1);
    };
    reader.readAsText(file);
  }

  function handleFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      processFile(target.files[0]);
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCounter++;
    isDragging = true;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      isDragging = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    isDragging = false;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      processFile(file);
    }
  }

  function resetModal() {
    fileName = "";
    fileSize = "";
    fileText = "";
    detectedRows = 0;
    isDragging = false;
    dragCounter = 0;
    isUploading = false;
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="w-full max-w-lg overflow-hidden p-6">
    <Dialog.Header>
      <div class="flex items-center gap-2.5">
        <div class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <UploadCloud class="size-5" />
        </div>
        <div>
          <Dialog.Title>Upload Product Sheet</Dialog.Title>
          <Dialog.Description>
            Select or drag and drop your product CSV catalogue to begin.
          </Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    <form
      method="POST"
      action="?/uploadSheet"
      enctype="multipart/form-data"
      use:enhance={() => {
        isUploading = true;
        return async ({ update }) => {
          await update();
          isUploading = false;
          open = false;
        };
      }}
    >
      <input type="hidden" name="csv_text" value={fileText} />
      <input type="hidden" name="filename" value={fileName} />

      <div class="space-y-4 py-3">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="relative flex min-h-[190px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer select-none
                 {isDragging
                   ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                   : fileName
                     ? 'border-success/50 bg-success/5'
                     : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/30'}"
          ondragenter={handleDragEnter}
          ondragover={handleDragOver}
          ondragleave={handleDragLeave}
          ondrop={handleDrop}
          onclick={() => fileInput?.click()}
          onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
        >
          <input
            type="file"
            name="sheet_file"
            accept=".csv,text/csv"
            class="hidden"
            bind:this={fileInput}
            onchange={handleFileSelected}
          />

          <div class="pointer-events-none flex flex-col items-center gap-2.5">
            {#if isDragging}
              <div class="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground">
                <UploadCloud class="size-6" />
              </div>
              <p class="text-sm font-bold text-primary">
                Drop your CSV file here
              </p>
              <p class="text-xs text-muted-foreground">Release to upload</p>
            {:else if fileName}
              <div class="grid size-12 place-items-center rounded-full bg-success/15 text-success">
                <FileText class="size-6" />
              </div>
              <div>
                <p class="font-mono text-sm font-bold text-foreground">{fileName}</p>
                <p class="mt-0.5 text-xs text-muted-foreground">{fileSize} · {detectedRows} rows detected</p>
              </div>
              <Badge variant="success" class="gap-1 mt-0.5">
                <Check class="size-3" /> Ready to save & configure
              </Badge>
              <span class="text-[11px] text-muted-foreground underline mt-1">Click to replace file</span>
            {:else}
              <div class="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                <UploadCloud class="size-6" />
              </div>
              <div>
                <p class="text-sm font-semibold text-foreground">
                  Drag and drop your CSV file here
                </p>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  or click to browse from your computer
                </p>
              </div>
              <p class="max-w-xs text-[11px] text-muted-foreground/80">
                Supports JewelWeSell, Shopify, or standard product CSV sheets
              </p>
            {/if}
          </div>
        </div>
      </div>

      <Dialog.Footer class="flex items-center justify-between border-t pt-4">
        <Button type="button" variant="outline" size="sm" onclick={resetModal}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!fileText || isUploading}
          class="gap-1.5"
        >
          {#if isUploading}
            <LoaderCircle class="size-3.5 animate-spin" />
            Saving to DB…
          {:else}
            Continue to Configuration
            <ArrowRight class="size-3.5" />
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
