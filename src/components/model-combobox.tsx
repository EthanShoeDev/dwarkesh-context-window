'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface ModelComboboxProps {
  models: string[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export function ModelCombobox({ models, value, onValueChange, disabled }: ModelComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const sortedModels = React.useMemo(() => {
    return [...models].sort((a, b) => {
      const providerA = a.split('/')[0]?.toLowerCase() || '';
      const providerB = b.split('/')[0]?.toLowerCase() || '';
      const nameA = a.split('/')[1]?.toLowerCase() || a.toLowerCase();
      const nameB = b.split('/')[1]?.toLowerCase() || b.toLowerCase();

      if (providerA !== providerB) {
        return providerA.localeCompare(providerB);
      }
      return nameA.localeCompare(nameB);
    });
  }, [models]);

  const filteredModels = React.useMemo(() => {
    if (!search.trim()) return sortedModels;
    const searchLower = search.toLowerCase();
    return sortedModels.filter((m) => m.toLowerCase().includes(searchLower));
  }, [sortedModels, search]);

  const formatModelLabel = (model: string) => {
    const parts = model.split('/');
    if (parts.length >= 2) {
      const provider = parts[0];
      const name = parts.slice(1).join('/');
      return { provider, name: name || model };
    }
    return { provider: '', name: model };
  };

  const handleSelect = (model: string) => {
    onValueChange(model);
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      setSearch('');
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger disabled={disabled}>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='w-[280px] justify-between h-11 px-3 font-normal'
        >
          {value ? (
            <span className='truncate'>
              {(() => {
                const { provider, name } = formatModelLabel(value);
                return provider ? `${provider} / ${name}` : name;
              })()}
            </span>
          ) : (
            <span className='text-muted-foreground'>Select model...</span>
          )}
          <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[280px] p-0' align='start'>
        <div className='flex flex-col'>
          <div className='flex items-center border-b px-3 py-2.5 gap-2'>
            <Search className='h-4 w-4 shrink-0 opacity-50' />
            <input
              ref={searchInputRef}
              placeholder='Search models...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='flex-1 h-9 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className='p-1.5 hover:bg-muted rounded-md transition-colors'
              >
                <X className='h-3.5 w-3.5' />
              </button>
            )}
          </div>
          <div className='max-h-[300px] overflow-y-auto'>
            {filteredModels.length === 0 ? (
              <div className='py-8 text-center text-sm text-muted-foreground'>No model found.</div>
            ) : (
              <div className='py-1.5'>
                {filteredModels.map((model) => {
                  const { provider, name } = formatModelLabel(model);
                  const isSelected = value === model;

                  return (
                    <button
                      key={model}
                      onClick={() => handleSelect(model)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer transition-colors hover:bg-muted/80',
                        isSelected && 'bg-muted/80',
                      )}
                    >
                      {provider && (
                        <span className='text-xs text-muted-foreground shrink-0 min-w-[65px] text-left font-medium'>
                          {provider}
                        </span>
                      )}
                      <span className='truncate flex-1 text-left'>{name}</span>
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isSelected ? 'opacity-100 text-foreground' : 'opacity-0',
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
