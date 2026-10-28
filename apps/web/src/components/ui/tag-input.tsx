'use client';

import { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TagInputProps {
    value: string[];
    onChange: (tags: string[]) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}

export function TagInput({ value = [], onChange, placeholder = "Add tag...", className, disabled }: TagInputProps) {
    const [inputValue, setInputValue] = useState('');

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag();
        } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
            // Remove last tag on backspace if input is empty
            onChange(value.slice(0, -1));
        }
    };

    const addTag = () => {
        if (disabled) return;
        const trimmed = inputValue.trim();
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed]);
            setInputValue('');
        }
    };

    const handleBlur = () => {
        addTag();
    };

    const removeTag = (tagToRemove: string) => {
        if (disabled) return;
        onChange(value.filter(tag => tag !== tagToRemove));
    };

    return (
        <div className={cn(
            "flex flex-wrap gap-2 items-center p-2 rounded-md border border-input bg-transparent focus-within:ring-1 focus-within:ring-ring",
            disabled && "opacity-50 cursor-not-allowed",
            className
        )}>
            {value.map((tag) => (
                <span
                    key={tag}
                    className="flex items-center gap-1 bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full animate-in fade-in zoom-in duration-200"
                >
                    {tag}
                    <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="hover:text-red-500 focus:outline-none disabled:cursor-not-allowed"
                        disabled={disabled}
                    >
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}
            <Input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder={value.length === 0 ? placeholder : ""}
                className="flex-1 border-none shadow-none focus-visible:ring-0 p-0 h-auto min-w-[80px] bg-transparent text-sm disabled:cursor-not-allowed"
                disabled={disabled}
            />
        </div>
    );
}
