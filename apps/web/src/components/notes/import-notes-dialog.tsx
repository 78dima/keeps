'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Upload, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNotesStore } from '@/store/useNotesStore';

export function ImportNotesDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();
    const { importNotes } = useNotesStore();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsLoading(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let allNotes: any[] = [];
        let errorCount = 0;

        try {
            // Process all selected files
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                try {
                    const text = await file.text();
                    const json = JSON.parse(text);

                    // Check if it's a single note object or array of notes
                    if (Array.isArray(json)) {
                        allNotes = [...allNotes, ...json];
                    } else if (typeof json === 'object') {
                        allNotes.push(json);
                    }
                } catch (parseError) {
                    console.error(`Failed to parse ${file.name}`, parseError);
                    errorCount++;
                }
            }

            if (allNotes.length === 0) {
                toast({ variant: "destructive", title: "No valid notes found" });
                return;
            }

            // Process locally and insert into RxDB
            await importNotes(allNotes);

            toast({
                title: "Import success",
                description: `Imported ${allNotes.length} notes.${errorCount > 0 ? ` Failed to parse ${errorCount} files.` : ''}`
            });

            setIsOpen(false);
        } catch (error) {
            console.error(error);
            toast({ variant: "destructive", title: "Import failed" });
        } finally {
            setIsLoading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" className="w-full justify-start text-sm font-medium text-muted-foreground hover:bg-muted/50">
                    <Upload className="mr-3 h-4 w-4" />
                    Import from Keep
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Import from Google Keep</DialogTitle>
                    <DialogDescription>
                        Select your Google Keep JSON files (exported via Google Takeout).
                        You can select multiple files at once.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="flex items-center justify-center w-full">
                        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                {isLoading ? (
                                    <div className="flex flex-col items-center">
                                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                                        <p className="text-sm text-muted-foreground">Importing...</p>
                                    </div>
                                ) : (
                                    <>
                                        <Upload className="w-8 h-8 mb-3 text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground text-center px-4">
                                            <span className="font-semibold">Click to upload</span> or drag and drop JSON files
                                        </p>
                                    </>
                                )}
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept=".json"
                                multiple
                                onChange={handleFileChange}
                                disabled={isLoading}
                            />
                        </label>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isLoading}>Cancel</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
