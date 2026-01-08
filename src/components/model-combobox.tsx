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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled}>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='w-[300px] justify-between h-10'
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
      <PopoverContent className='w-[300px] p-0' align='start'>
        <div className='flex flex-col'>
          <div className='flex items-center border-b px-3 gap-2'>
            <Search className='h-4 w-4 shrink-0 opacity-50' />
            <input
              placeholder='Search models...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='flex-1 h-10 bg-transparent text-sm outline-none placeholder:text-muted-foreground'
            />
            {search && (
              <button onClick={() => setSearch('')} className='p-1 hover:bg-muted rounded'>
                <X className='h-3 w-3' />
              </button>
            )}
          </div>
          <div className='max-h-[280px] overflow-y-auto'>
            {filteredModels.length === 0 ? (
              <div className='py-6 text-center text-sm text-muted-foreground'>No model found.</div>
            ) : (
              <div className='py-1'>
                {filteredModels.map((model) => {
                  const { provider, name } = formatModelLabel(model);
                  const isSelected = value === model;

                  return (
                    <button
                      key={model}
                      onClick={() => handleSelect(model)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted transition-colors',
                        isSelected && 'bg-muted',
                      )}
                    >
                      {provider && (
                        <span className='text-xs text-muted-foreground shrink-0 min-w-[60px] text-left'>
                          {provider}
                        </span>
                      )}
                      <span className='truncate flex-1 text-left'>{name}</span>
                      <Check
                        className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
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
